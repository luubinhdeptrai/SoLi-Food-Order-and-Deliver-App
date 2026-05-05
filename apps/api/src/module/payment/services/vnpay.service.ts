import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import * as crypto from 'crypto';
import { vnpayConfig } from '@/config/vnpay.config';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** VNPay API version used throughout the integration. */
const VNPAY_VERSION = '2.1.0';

/** VNPay command for creating a payment URL. */
const VNPAY_COMMAND_PAY = 'pay';

/** VNPay currency code — Vietnamese Dong. */
const VNPAY_CURRENCY_VND = 'VND';

/** VNPay locale — Vietnamese. Can be changed per-request if needed. */
const VNPAY_LOCALE_VN = 'vn';

/**
 * VNPay order type code for food & beverage.
 * See VNPay merchant documentation, category list.
 */
const VNPAY_ORDER_TYPE_FOOD = '250000';

/**
 * UTC+7 offset in milliseconds.
 * VNPay requires dates in Vietnam Standard Time.
 */
const VIETNAM_TZ_OFFSET_MS = 7 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Typed result returned by verifyIpn(). */
export interface IpnVerificationResult {
  /** Whether the HMAC signature is valid. False = reject without DB mutation. */
  valid: boolean;
  /**
   * True when vnp_ResponseCode === '00' AND vnp_TransactionStatus === '00'.
   * This indicates the customer's bank approved the charge.
   */
  responsePaid: boolean;
  /**
   * Amount decoded from vnp_Amount (divided by 100 to convert VND × 100 back).
   * 0 when the IPN signature is invalid.
   */
  amount: number;
  /**
   * Our internal transaction reference (vnp_TxnRef = PaymentTransaction.id).
   * Used by the IPN handler to look up the PaymentTransaction by primary key.
   * Empty string when the IPN signature is invalid.
   */
  txnRef: string;
  /**
   * VNPay's own transaction identifier (vnp_TransactionNo).
   * Stored as payment_transactions.provider_txn_id for idempotency (D-P4).
   * Empty string when the IPN signature is invalid.
   */
  providerTxnId: string;
}

/** Parameters required to build a VNPay payment URL. */
export interface VNPayUrlParams {
  /** PaymentTransaction.id — used as vnp_TxnRef (echoed back in IPN). */
  txnRef: string;
  /** Order total in VND (NUMERIC 12,2). Multiplied by 100 before sending. */
  amount: number;
  /** Client IP address. IPv4-mapped IPv6 prefixes are stripped. */
  ipAddr: string;
}

// ---------------------------------------------------------------------------
// VNPayService
// ---------------------------------------------------------------------------

/**
 * VNPayService — Pure VNPay adapter. No business logic, no DB access.
 *
 * Responsibilities:
 *   - Build signed payment URLs for browser redirect
 *   - Verify HMAC SHA512 signatures on IPN and return-URL callbacks
 *
 * All signing uses:
 *   1. URL-encode keys (for sorting) and values (for signing)
 *   2. Sort by URL-encoded key (VNPay requirement — see sortAndBuildSignData)
 *   3. HMAC SHA512 with VNPAY_HASH_SECRET
 *   4. Constant-time comparison via crypto.timingSafeEqual (OWASP timing attack prevention)
 *
 * Configuration (required env vars — validated at startup by Zod schema in env.schema.ts):
 *   VNPAY_TMN_CODE              Merchant terminal code
 *   VNPAY_HASH_SECRET           HMAC signing key (never log this)
 *   VNPAY_URL                   VNPay payment endpoint URL
 *   VNPAY_RETURN_URL            Browser redirect target after payment
 *   PAYMENT_SESSION_TIMEOUT_SECONDS  Session expiry window (default 1800)
 */
@Injectable()
export class VNPayService implements OnModuleInit {
  private readonly logger = new Logger(VNPayService.name);

  private tmnCode!: string;
  private hashSecret!: string;
  private vnpUrl!: string;
  private returnUrl!: string;
  private sessionTimeoutMs!: number;

  constructor(
    @Inject(vnpayConfig.KEY)
    private readonly config: ConfigType<typeof vnpayConfig>,
  ) {}

  /**
   * Assign config values at startup.
   *
   * Environment variables are already validated by the Zod schema in
   * env.schema.ts before this hook runs — no manual checks needed here.
   * All values are guaranteed non-null and correctly typed.
   */
  onModuleInit(): void {
    this.tmnCode = this.config.tmnCode;
    this.hashSecret = this.config.hashSecret;
    this.vnpUrl = this.config.url;
    this.returnUrl = this.config.returnUrl;
    this.sessionTimeoutMs = this.config.sessionTimeoutSeconds * 1_000;

    // Note: hashSecret intentionally omitted from the log line.
    this.logger.log(
      `VNPayService initialized — tmnCode=${this.tmnCode} url=${this.vnpUrl} ` +
        `sessionTimeout=${this.config.sessionTimeoutSeconds}s`,
    );
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Builds the VNPay payment redirect URL for a given transaction.
   *
   * The URL carries all required payment parameters, signed with HMAC SHA512.
   * VNPay will verify the signature when the browser loads the URL.
   *
   * @param params  txnRef (= PaymentTransaction.id), amount (VND), ipAddr
   * @returns Full VNPay redirect URL including vnp_SecureHash
   */
  buildPaymentUrl(params: VNPayUrlParams): string {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.sessionTimeoutMs);

    // Build the params object in the order they will appear before sorting.
    // All values must be strings — VNPay rejects numeric types.
    const vnpParams: Record<string, string> = {
      vnp_Version: VNPAY_VERSION,
      vnp_Command: VNPAY_COMMAND_PAY,
      vnp_TmnCode: this.tmnCode,
      // Amount in VND × 100 (no decimal point, integer only).
      // Math.round guards against floating-point artifacts like 99.99 * 100 = 9998.9999...
      vnp_Amount: String(Math.round(params.amount * 100)),
      vnp_CreateDate: this.formatVNPayDate(now),
      vnp_CurrCode: VNPAY_CURRENCY_VND,
      vnp_IpAddr: this.sanitizeIpAddr(params.ipAddr),
      vnp_Locale: VNPAY_LOCALE_VN,
      vnp_OrderInfo: `SoLi Order ${params.txnRef}`,
      vnp_OrderType: VNPAY_ORDER_TYPE_FOOD,
      vnp_ReturnUrl: this.returnUrl,
      vnp_TxnRef: params.txnRef,
      vnp_ExpireDate: this.formatVNPayDate(expiresAt),
    };

    // Build the sign data string (encode → sort → join).
    // This string is what VNPay will re-derive when verifying the URL.
    const signData = this.sortAndBuildSignData(vnpParams);
    const signature = this.hmacSha512(signData);

    // Append vnp_SecureHash AFTER signing — it must not be part of signData.
    // The final URL is: baseParams + &vnp_SecureHash=<signature>
    return `${this.vnpUrl}?${signData}&vnp_SecureHash=${signature}`;
  }

  /**
   * Verifies the HMAC SHA512 signature on an IPN callback from VNPay.
   *
   * Security requirements:
   *   - Strip BOTH vnp_SecureHash AND vnp_SecureHashType before re-signing.
   *     Including vnp_SecureHashType in the signed data causes every IPN to fail.
   *   - Use crypto.timingSafeEqual to prevent timing oracle attacks.
   *   - Never write to DB if valid=false — the IPN may be a spoofed request.
   *
   * @param query Raw query params from the IPN GET request (Record<string,string>)
   * @returns IpnVerificationResult
   */
  verifyIpn(query: Record<string, string>): IpnVerificationResult {
    const {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      vnp_SecureHash: receivedHash,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      vnp_SecureHashType: _hashType,
      ...paramsWithoutHash
    } = query;

    if (!receivedHash) {
      this.logger.warn('IPN missing vnp_SecureHash — rejected');
      return { valid: false, responsePaid: false, amount: 0, txnRef: '', providerTxnId: '' };
    }

    const signData = this.sortAndBuildSignData(paramsWithoutHash);
    const expectedHash = this.hmacSha512(signData);

    const valid = this.timingSafeCompare(receivedHash, expectedHash);

    if (!valid) {
      this.logger.warn('IPN signature mismatch — potential spoofed request');
      return { valid: false, responsePaid: false, amount: 0, txnRef: '', providerTxnId: '' };
    }

    // Both vnp_ResponseCode and vnp_TransactionStatus must be '00' for a
    // successful payment. vnp_ResponseCode alone being '00' is not sufficient
    // in some edge cases (bank success but system error).
    const responsePaid =
      query.vnp_ResponseCode === '00' &&
      query.vnp_TransactionStatus === '00';

    const rawAmount = parseInt(query.vnp_Amount ?? '0', 10);
    const amount = rawAmount / 100; // Convert VND × 100 back to VND

    return {
      valid: true,
      responsePaid,
      amount,
      // vnp_TxnRef = our PaymentTransaction.id (primary key lookup for IPN handler)
      txnRef: query.vnp_TxnRef ?? '',
      // vnp_TransactionNo = VNPay's own ID (idempotency key, D-P4)
      providerTxnId: query.vnp_TransactionNo ?? '',
    };
  }

  /**
   * Verifies the signature on the return URL callback.
   * Same algorithm as verifyIpn() but returns only { valid, code }.
   *
   * IMPORTANT: This method must NEVER write to the database.
   * Return URLs are browser-initiated and can be tampered with.
   * They are for UI display only.
   *
   * @param query Raw query params from the return GET request
   * @returns { valid: boolean; code: string } — code is vnp_ResponseCode
   */
  verifyReturn(query: Record<string, string>): { valid: boolean; code: string } {
    const {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      vnp_SecureHash: receivedHash,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      vnp_SecureHashType: _hashType,
      ...paramsWithoutHash
    } = query;

    if (!receivedHash) {
      return { valid: false, code: query.vnp_ResponseCode ?? 'unknown' };
    }

    const signData = this.sortAndBuildSignData(paramsWithoutHash);
    const expectedHash = this.hmacSha512(signData);

    const valid = this.timingSafeCompare(receivedHash, expectedHash);

    return {
      valid,
      code: query.vnp_ResponseCode ?? 'unknown',
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Builds the sign data string used for HMAC computation.
   *
   * VNPay requires:
   *   1. URL-encode each key (encodeURIComponent)
   *   2. URL-encode each value (encodeURIComponent, then %20 → '+')
   *   3. Sort by URL-encoded key (lexicographic / localeCompare)
   *   4. Join as `encodedKey=encodedValue` pairs separated by '&'
   *
   * Why encode-first, sort-second: VNPay's own verification algorithm
   * sorts on the URL-encoded representation. Sorting raw keys produces
   * a different order for keys containing special characters, causing
   * signature mismatch even with the correct secret key.
   *
   * Why %20 → '+': Traditional form URL encoding uses '+' for spaces.
   * VNPay's reference implementation uses this convention.
   */
  private sortAndBuildSignData(params: Record<string, string>): string {
    const entries: Array<[string, string]> = Object.entries(params).map(
      ([key, value]) => [
        encodeURIComponent(key),
        encodeURIComponent(value).replace(/%20/g, '+'),
      ],
    );

    // Deterministic ASCII sort on URL-encoded keys (same algorithm as VNPay server).
    // Using explicit comparison operators instead of localeCompare() to guarantee
    // byte-order sorting regardless of the Node.js process locale setting.
    // All VNPay param keys are ASCII (vnp_*), so locale-aware collation would
    // never differ in practice — but defensive determinism matters here.
    entries.sort(([keyA], [keyB]) => (keyA < keyB ? -1 : keyA > keyB ? 1 : 0));

    return entries.map(([key, value]) => `${key}=${value}`).join('&');
  }

  /**
   * Computes HMAC SHA512 over `data` using the VNPay hash secret.
   * Returns lowercase hex digest.
   */
  private hmacSha512(data: string): string {
    return crypto
      .createHmac('sha512', this.hashSecret)
      .update(Buffer.from(data, 'utf-8'))
      .digest('hex');
  }

  /**
   * Timing-safe string comparison for HMAC digests.
   *
   * Normalizes both strings to lowercase before comparison (VNPay may send
   * either case). Uses crypto.timingSafeEqual to prevent timing oracle attacks
   * where an attacker could brute-force a valid signature by measuring response
   * time differences.
   *
   * Length check: SHA512 hex is always 128 chars. A different length means
   * the received hash is definitely invalid — the fast-fail here does NOT leak
   * information about the secret because the length is public knowledge.
   */
  private timingSafeCompare(received: string, expected: string): boolean {
    const normalizedReceived = received.toLowerCase();
    const normalizedExpected = expected.toLowerCase();

    // Fast-fail on length mismatch: this is safe because hash length is not secret.
    if (normalizedReceived.length !== normalizedExpected.length) {
      return false;
    }

    try {
      return crypto.timingSafeEqual(
        Buffer.from(normalizedReceived),
        Buffer.from(normalizedExpected),
      );
    } catch {
      // timingSafeEqual can throw if buffers have different lengths — guard defensively.
      return false;
    }
  }

  /**
   * Formats a Date to the VNPay date string format: YYYYMMDDHHmmss in UTC+7.
   * Does NOT use moment — derives UTC+7 time via manual offset arithmetic.
   */
  private formatVNPayDate(date: Date): string {
    // Shift the UTC timestamp by +7 hours, then read UTC fields.
    const vietnamTime = new Date(date.getTime() + VIETNAM_TZ_OFFSET_MS);

    const pad = (n: number): string => String(n).padStart(2, '0');

    return (
      vietnamTime.getUTCFullYear() +
      pad(vietnamTime.getUTCMonth() + 1) +
      pad(vietnamTime.getUTCDate()) +
      pad(vietnamTime.getUTCHours()) +
      pad(vietnamTime.getUTCMinutes()) +
      pad(vietnamTime.getUTCSeconds())
    );
  }

  /**
   * Strips the `::ffff:` IPv4-mapped IPv6 prefix that Node.js/Express appends
   * to IPv4 addresses when the server is bound to `::` (dual-stack).
   *
   * VNPay validates ipAddr format. Sending `::ffff:127.0.0.1` fails validation.
   * Falls back to '127.0.0.1' when ipAddr is empty (e.g. during integration tests).
   */
  private sanitizeIpAddr(ipAddr: string): string {
    const cleaned = (ipAddr ?? '').replace(/^::ffff:/i, '').trim();
    return cleaned || '127.0.0.1';
  }
}
