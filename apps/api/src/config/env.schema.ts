import { z } from 'zod';

/**
 * Zod schema for all required environment variables.
 *
 * This schema is passed to ConfigModule.forRoot({ validate }) so that the
 * application FAILS FAST at startup — before any module is initialized —
 * when a required variable is missing or has an invalid value.
 *
 * Benefits over the previous onModuleInit() per-service checks:
 *   - One canonical location for all env validation rules.
 *   - Clear, structured error messages at startup (lists ALL missing vars,
 *     not just the first one encountered).
 *   - Type coercion handled here (e.g. REDIS_PORT string → number) so
 *     downstream consumers receive correctly-typed values.
 *   - Defaults are applied consistently before any factory function runs.
 */
export const envSchema = z.object({
  // ---------------------------------------------------------------------------
  // Database
  // ---------------------------------------------------------------------------
  DATABASE_URL: z
    .string()
    .min(
      1,
      'DATABASE_URL is required — format: postgresql://user:pass@host:port/db',
    ),

  // ---------------------------------------------------------------------------
  // Better Auth
  // ---------------------------------------------------------------------------
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters for security'),
  BETTER_AUTH_URL: z
    .string()
    .url('BETTER_AUTH_URL must be a valid URL')
    .default('http://localhost:3000'),

  // ---------------------------------------------------------------------------
  // Redis
  // ---------------------------------------------------------------------------
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),

  // ---------------------------------------------------------------------------
  // VNPay — all four are required; no defaults (production payment credentials)
  // ---------------------------------------------------------------------------
  VNPAY_TMN_CODE: z
    .string()
    .trim()
    .min(1, 'VNPAY_TMN_CODE is required — obtain from VNPay merchant portal'),
  VNPAY_HASH_SECRET: z
    .string()
    .trim()
    .min(
      1,
      'VNPAY_HASH_SECRET is required — HMAC signing key from VNPay portal',
    ),
  VNPAY_URL: z
    .string()
    .url(
      'VNPAY_URL must be a valid URL (e.g. https://sandbox.vnpayment.vn/paymentv2/vpcpay.html)',
    ),
  VNPAY_RETURN_URL: z
    .string()
    .url(
      'VNPAY_RETURN_URL must be a valid URL (e.g. http://localhost:3000/api/payments/vnpay/return)',
    ),

  // ---------------------------------------------------------------------------
  // Payment session window — optional with a safe default
  // ---------------------------------------------------------------------------
  PAYMENT_SESSION_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .positive('PAYMENT_SESSION_TIMEOUT_SECONDS must be a positive integer')
    .default(1800),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validation function passed to ConfigModule.forRoot({ validate }).
 * NestJS calls this synchronously during ConfigModule initialization.
 * Throwing here aborts the bootstrap sequence with a clear error message.
 */
export function validate(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `\n\n🚨 Environment configuration is invalid:\n${issues}\n\n` +
        `Copy .env.example to .env and fill in the required values.\n`,
    );
  }

  return result.data;
}
