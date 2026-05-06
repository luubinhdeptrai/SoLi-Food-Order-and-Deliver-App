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
  /** Order total in integer VND. Multiplied by 100 before sending to VNPay. */
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

    this.logger.log(
      'VNPay IPN URL must be configured in the merchant portal. ' +
        'Contact VNPay support to set the IPN callback URL for your account.',
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
      // Amount in VND × 100. amount is already an integer VND value
      // (enforced by the schema and validation layer), so amount * 100
      // is always an exact integer with no floating-point rounding error.
      vnp_Amount: String(params.amount * 100),
      vnp_CreateDate: this.formatVNPayDate(now),
      vnp_CurrCode: VNPAY_CURRENCY_VND,
      vnp_IpAddr: this.sanitizeIpAddr(params.ipAddr),
      vnp_Locale: VNPAY_LOCALE_VN,
      vnp_OrderInfo: `SoLi_Order_${params.txnRef}`,
      vnp_OrderType: VNPAY_ORDER_TYPE_FOOD,
      vnp_ReturnUrl: this.returnUrl,
      vnp_TxnRef: params.txnRef,
      vnp_ExpireDate: this.formatVNPayDate(expiresAt),
    };

    // Step 1: Strip hidden control chars (\r \n \t) and surrounding whitespace
    // from every param value before signing. A stray newline in vnp_OrderInfo
    // or anywhere else causes the hashData line to break, producing a different
    // string than the single-line format VNPay expects.
    const sanitized = this.sanitizeParams(vnpParams);

    // Step 2: Build hashData with RAW sanitized values — no URL encoding.
    const hashData = this.buildHashData(sanitized);
    const signature = this.hmacSha512(hashData);

    // Log raw strings (not JSON.stringify) to see the actual HMAC input.
    this.logger.debug(`buildPaymentUrl — ipAddr=${sanitized['vnp_IpAddr']}`);
    this.logger.debug(`hashData=${hashData}`);
    this.logger.debug(`secureHash=${signature}`);

    // Step 3: Build URL-encoded query string from the same sanitized params.
    // vnp_SecureHash is appended AFTER signing — must NOT be part of hashData.
    const queryString = this.buildQueryString(sanitized);
    return `${this.vnpUrl}?${queryString}&vnp_SecureHash=${signature}`;
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
    this.logger.debug(
      `IPN received — txnRef=${query['vnp_TxnRef'] ?? '(none)'} ` +
        `responseCode=${query['vnp_ResponseCode'] ?? '(none)'} ` +
        `transactionStatus=${query['vnp_TransactionStatus'] ?? '(none)'}`,
    );

    const {
      vnp_SecureHash: receivedHash,
      vnp_SecureHashType: _hashType, // eslint-disable-line @typescript-eslint/no-unused-vars -- must exclude from signData
      ...paramsWithoutHash
    } = query;

    if (!receivedHash) {
      this.logger.warn('IPN missing vnp_SecureHash — rejected');
      return {
        valid: false,
        responsePaid: false,
        amount: 0,
        txnRef: '',
        providerTxnId: '',
      };
    }

    const signData = this.buildHashData(paramsWithoutHash);
    const expectedHash = this.hmacSha512(signData);

    const valid = this.timingSafeCompare(receivedHash, expectedHash);

    if (!valid) {
      this.logger.warn('IPN signature mismatch — potential spoofed request');
      return {
        valid: false,
        responsePaid: false,
        amount: 0,
        txnRef: '',
        providerTxnId: '',
      };
    }

    // Both vnp_ResponseCode and vnp_TransactionStatus must be '00' for a
    // successful payment. vnp_ResponseCode alone being '00' is not sufficient
    // in some edge cases (bank success but system error).
    const responsePaid =
      query.vnp_ResponseCode === '00' && query.vnp_TransactionStatus === '00';

    const rawAmount = parseInt(query.vnp_Amount ?? '0', 10);
    // VNPay sends vnp_Amount = integer_VND × 100.
    // Dividing by 100 always yields an exact integer since our amounts are whole VND.
    const amount = rawAmount / 100;

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
  verifyReturn(query: Record<string, string>): {
    valid: boolean;
    code: string;
  } {
    const {
      vnp_SecureHash: receivedHash,
      vnp_SecureHashType: _hashType, // eslint-disable-line @typescript-eslint/no-unused-vars -- must exclude from signData
      ...paramsWithoutHash
    } = query;

    if (!receivedHash) {
      return { valid: false, code: query.vnp_ResponseCode ?? 'unknown' };
    }

    const signData = this.buildHashData(paramsWithoutHash);
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
   * Removes \r, \n, \t and surrounding whitespace from every param value.
   * A hidden newline in any value (e.g. vnp_OrderInfo) breaks hashData into
   * multiple lines, producing a hash that never matches VNPay's single-line
   * re-derivation.
   */
  private sanitizeParams(
    params: Record<string, string>,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      result[key] = value.replace(/[\r\n\t]/g, '').trim();
    }
    return result;
  }

  /**
   * Builds the hashData string used as HMAC input.
   *
   * Mirrors VNPay's official PHP reference implementation exactly:
   *
   *   ksort($params);
   *   foreach ($params as $key => $value) {
   *     $hashdata .= urlencode($key) . "=" . urlencode($value) . "&";
   *   }
   *   hash_hmac('sha512', rtrim($hashdata, '&'), $secret);
   *
   * PHP's urlencode() encodes spaces as '+' (not '%20') and encodes special
   * characters like ':', '/', '.' with percent-encoding. We replicate this
   * with: encodeURIComponent(v).replace(/%20/g, '+').
   *
   * WHY encoding is required:
   *   VNPay's server receives the URL, PHP's $_GET URL-decodes all params
   *   (giving raw values like "http://localhost:3000/..."), then re-applies
   *   urlencode() on each value before computing HMAC. Our hash input must
   *   therefore also use encoded values — otherwise:
   *     Our input:  vnp_ReturnUrl=http://localhost:3000/...
   *     VNPay's:    vnp_ReturnUrl=http%3A%2F%2Flocalhost%3A3000%2F...
   *     → MISMATCH → "Sai chữ ký"
   *
   * NOTE: This encoding is NOT applied to buildQueryString — that method uses
   * standard encodeURIComponent (no '+' substitution) for the browser URL.
   */
  private buildHashData(params: Record<string, string>): string {
    return Object.keys(params)
      .sort()
      .map(
        (key) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(params[key]).replace(/%20/g, '+')}`,
      )
      .join('&');
  }

  /**
   * Builds the URL query string for the payment redirect URL.
   *
   * Separate from buildHashData: values are URL-encoded here so the browser
   * and VNPay's server can correctly parse all characters (including ':' and
   * '/' in vnp_ReturnUrl).
   *
   * Note: vnp_SecureHash is appended AFTER this string, outside this method.
   */
  private buildQueryString(params: Record<string, string>): string {
    return Object.entries(params)
      .sort(([keyA], [keyB]) => (keyA < keyB ? -1 : keyA > keyB ? 1 : 0))
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
      )
      .join('&');
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
   * Sanitizes the client IP address for VNPay submission.
   *
   * VNPay does NOT accept localhost IPs (127.* or ::1). For local development,
   * we use a dummy public IP (1.1.1.1). In production, use a real client IP
   * extracted from x-forwarded-for or req.socket.remoteAddress.
   *
   * Steps:
   *   1. Strip the `::ffff:` IPv4-mapped IPv6 prefix (Node.js/Express dual-stack).
   *   2. Detect localhost patterns (127.*, ::1, ::ffff:127.*).
   *   3. Return a dummy public IP for localhost, or the cleaned IP otherwise.
   */
  private sanitizeIpAddr(ipAddr: string): string {
    const cleaned = (ipAddr ?? '').replace(/^::ffff:/i, '').trim();

    // Empty, IPv6 loopback, or IPv4 loopback → use dummy public IP.
    if (!cleaned || cleaned === '::1' || cleaned.startsWith('127.')) {
      return '1.1.1.1';
    }

    return cleaned;
  }
}
