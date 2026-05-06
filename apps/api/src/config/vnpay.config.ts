import { registerAs } from '@nestjs/config';

/**
 * VNPay configuration namespace.
 *
 * Registered under the 'vnpay' key so consumers can inject it with:
 *
 *   @Inject(vnpayConfig.KEY) private readonly config: ConfigType<typeof vnpayConfig>
 *
 * This factory runs AFTER the Zod validate() function in ConfigModule.forRoot(),
 * so all values are guaranteed to be present and valid at this point.
 * Non-null assertions are therefore safe.
 *
 * Never add this object to logs — hashSecret must never be exposed.
 */
export const vnpayConfig = registerAs('vnpay', () => ({
  /** Merchant Terminal Code — identifies the merchant to VNPay. */
  tmnCode: process.env['VNPAY_TMN_CODE']!,

  /**
   * HMAC SHA512 signing key.
   * Treat as a high-value secret: never log, never expose in errors.
   */
  hashSecret: process.env['VNPAY_HASH_SECRET']!,

  /** VNPay payment gateway URL (sandbox or production). */
  url: process.env['VNPAY_URL']!,

  /**
   * Browser redirect URL after payment completes.
   * Must be registered in the VNPay merchant portal whitelist.
   */
  returnUrl: process.env['VNPAY_RETURN_URL']!,

  /**
   * Payment session timeout in seconds (default 1800 = 30 min).
   * Used for both vnp_ExpireDate and PaymentTransaction.expiresAt.
   */
  sessionTimeoutSeconds: parseInt(
    process.env['PAYMENT_SESSION_TIMEOUT_SECONDS'] ?? '1800',
    10,
  ),
}));

/** Strongly-typed VNPay config shape. */
export type VNPayConfig = ReturnType<typeof vnpayConfig>;
