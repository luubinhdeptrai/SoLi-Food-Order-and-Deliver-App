/**
 * payment-phase8.e2e-spec.ts — Phase 8 Payment BC E2E Tests
 *
 * Covers the full VNPay payment lifecycle:
 *  §1  COD checkout — no paymentUrl, order created normally
 *  §2  VNPay checkout — paymentUrl returned, PaymentTransaction created
 *  §3  Validate paymentUrl — required params + secure hash present
 *  §4  VNPay return URL — signature check + DB status reflection
 *  §5  VNPay IPN (success) — signature verified, DB updated to completed
 *  §6  Invalid IPN signature — rejected (RspCode=97), no DB mutation
 *  §7  IPN idempotency — second call acknowledged without re-processing
 *
 * Architecture notes:
 *  - All state changes go through HTTP (same pattern as order.e2e-spec.ts).
 *  - Signature helpers replicate VNPayService.buildHashData() exactly so we
 *    can construct payloads that pass server-side HMAC verification.
 *  - VNPAY_HASH_SECRET is read from process.env (loaded by env-setup.ts).
 *  - payment_transactions are deleted in beforeAll alongside resetDb().
 */

import * as crypto from 'crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createTestApp, teardownTestApp } from '../setup/app-factory';
import {
  resetDb,
  seedBaseRestaurant,
  TEST_RESTAURANT_ID,
  getTestDb,
} from '../setup/db-setup';
import { TestAuthManager } from '../helpers/test-auth';
import { setAuthManager, ownerHeaders } from '../helpers/auth';
import { paymentTransactions } from '../../src/module/payment/domain/payment-transaction.schema';

// ─── Timing helper ────────────────────────────────────────────────────────────
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── VNPay signature helpers ──────────────────────────────────────────────────
//
// These MUST exactly mirror VNPayService.buildHashData() + hmacSha512().
// Algorithm (VNPay official PHP reference):
//   1. Exclude vnp_SecureHash and vnp_SecureHashType from the param set.
//   2. Sort remaining params by URL-encoded key (ASCII).
//   3. Join as: encodeURIComponent(key)=encodeURIComponent(value) with '+' for spaces.
//   4. HMAC SHA512 over the resulting string, UTF-8 encoded.

/**
 * Mirrors VNPayService.buildHashData() — URL-encode keys + values, sort, join.
 * Values that are already URL-safe (alphanumeric, _, -, .) are unchanged.
 */
function buildTestHashData(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map(
      (key) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(params[key]).replace(/%20/g, '+')}`,
    )
    .join('&');
}

/**
 * Mirrors VNPayService.hmacSha512() — HMAC SHA512 with UTF-8 input.
 */
function buildTestSignature(
  paramsForHash: Record<string, string>,
  secret: string,
): string {
  const hashData = buildTestHashData(paramsForHash);
  return crypto
    .createHmac('sha512', secret)
    .update(Buffer.from(hashData, 'utf-8'))
    .digest('hex');
}

/**
 * Builds a complete VNPay IPN payload with a valid signature.
 *
 * `paramsForHash` does NOT include vnp_SecureHash or vnp_SecureHashType —
 * VNPayService.verifyIpn() strips both before computing the expected hash.
 *
 * @param txnRef       PaymentTransaction.id (= vnp_TxnRef echoed by VNPay)
 * @param amountVnd    Total order amount in VND (integer, e.g. 15000)
 * @param secret       VNPAY_HASH_SECRET from environment
 * @param overrides    Per-test param overrides (e.g. to trigger amount mismatch)
 */
function buildIpnPayload(
  txnRef: string,
  amountVnd: number,
  secret: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const baseParams: Record<string, string> = {
    vnp_Amount: String(Math.round(amountVnd * 100)),
    vnp_BankCode: 'NCB',
    vnp_BankTranNo: 'VNP14069932',
    vnp_CardType: 'ATM',
    vnp_OrderInfo: `SoLi_Order_${txnRef}`,
    vnp_PayDate: '20260505120000',
    vnp_ResponseCode: '00',
    vnp_TmnCode: process.env['VNPAY_TMN_CODE'] ?? 'QYVC9P4C',
    vnp_TransactionNo: '14069932',
    vnp_TransactionStatus: '00',
    vnp_TxnRef: txnRef,
    ...overrides,
  };

  const signature = buildTestSignature(baseParams, secret);

  return {
    ...baseParams,
    vnp_SecureHashType: 'SHA512',
    vnp_SecureHash: signature,
  };
}

/**
 * Builds a VNPay return-URL parameter set with a valid signature.
 * Mirrors the params VNPay includes in the browser redirect back to the
 * merchant's return URL after a completed payment.
 */
function buildReturnParams(
  txnRef: string,
  amountVnd: number,
  secret: string,
  responseCode = '00',
): Record<string, string> {
  const baseParams: Record<string, string> = {
    vnp_Amount: String(Math.round(amountVnd * 100)),
    vnp_BankCode: 'NCB',
    vnp_CardType: 'ATM',
    vnp_OrderInfo: `SoLi_Order_${txnRef}`,
    vnp_PayDate: '20260505120000',
    vnp_ResponseCode: responseCode,
    vnp_TmnCode: process.env['VNPAY_TMN_CODE'] ?? 'QYVC9P4C',
    vnp_TransactionNo: '14069932',
    vnp_TransactionStatus: responseCode === '00' ? '00' : '01',
    vnp_TxnRef: txnRef,
  };

  const signature = buildTestSignature(baseParams, secret);

  return {
    ...baseParams,
    vnp_SecureHashType: 'SHA512',
    vnp_SecureHash: signature,
  };
}

// ─── DB helper — read a PaymentTransaction by id ──────────────────────────────
async function getPaymentTransaction(id: string) {
  const db = getTestDb();
  const rows = await db
    .select()
    .from(paymentTransactions)
    .where(eq(paymentTransactions.id, id))
    .limit(1);
  return rows[0] ?? null;
}

// ─── DB helper — delete all payment_transactions ─────────────────────────────
async function resetPaymentTransactions(): Promise<void> {
  const db = getTestDb();
  await db.delete(paymentTransactions);
}

// ─── Extract vnp_TxnRef from a signed VNPay payment URL ──────────────────────
function extractTxnRef(paymentUrl: string): string {
  try {
    const parsed = new URL(paymentUrl);
    const ref = parsed.searchParams.get('vnp_TxnRef');
    if (!ref) throw new Error('vnp_TxnRef missing from paymentUrl');
    return ref;
  } catch {
    // Fallback: regex extract in case URL constructor fails on the sandbox host
    const match = /[?&]vnp_TxnRef=([^&]+)/.exec(paymentUrl);
    if (!match?.[1]) throw new Error('Could not extract vnp_TxnRef from URL');
    return decodeURIComponent(match[1]);
  }
}

// ─── Main suite ───────────────────────────────────────────────────────────────

describe('Payment Phase 8 E2E', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  /** The test menu item whose snapshot is seeded in beforeAll. */
  let menuItemId: string;

  /** VNPAY_HASH_SECRET — read from process.env once, used in all signature helpers. */
  let hashSecret: string;

  // ─── Global setup ──────────────────────────────────────────────────────────

  beforeAll(async () => {
    // Validate that VNPay credentials are present before running any test.
    hashSecret = process.env['VNPAY_HASH_SECRET'] ?? '';
    if (!hashSecret) {
      throw new Error(
        'VNPAY_HASH_SECRET is not set. Add it to .env or .env.test before running payment E2E tests.',
      );
    }

    app = await createTestApp();
    http = request(app.getHttpServer());

    // Delete payment_transactions first (no FK to orders) then reset the rest.
    await resetPaymentTransactions();
    await resetDb();

    const testAuth = new TestAuthManager();
    await testAuth.initialize(http);
    setAuthManager(testAuth);
    await seedBaseRestaurant(testAuth.ownerUserId);

    // Trigger the restaurant snapshot projection so ordering can validate
    // restaurant.isOpen + isApproved at checkout time.
    const patchRes = await http
      .patch(`/api/restaurants/${TEST_RESTAURANT_ID}`)
      .set(ownerHeaders())
      .send({ name: 'E2E Test Restaurant' });
    expect(patchRes.status).toBe(200);
    await delay(200);

    // Create the test menu item — fires MenuItemCreatedEvent so the ordering
    // ACL snapshot is populated before any cart/checkout operation.
    const itemRes = await http
      .post('/api/menu-items')
      .set(ownerHeaders())
      .send({
        restaurantId: TEST_RESTAURANT_ID,
        name: 'Test Burger',
        price: 15000,
      });
    expect(itemRes.status).toBe(201);
    menuItemId = itemRes.body.id as string;

    await delay(200);

    // Clear any stale carts from a previous test run.
    await http.delete('/api/carts/my').set(ownerHeaders());
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  // ─── Helper: populate cart with one burger ─────────────────────────────────
  async function addItemToCart() {
    const res = await http
      .post('/api/carts/my/items')
      .set(ownerHeaders())
      .send({
        menuItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'E2E Test Restaurant',
        itemName: 'Test Burger',
        unitPrice: 15000,
        quantity: 1,
      });
    expect(res.status).toBe(201);
  }

  // ─── Shared delivery address fixture (no coordinates → shippingFee = 0) ───
  const DELIVERY_ADDRESS = {
    street: '123 Test Street',
    district: 'District 1',
    city: 'Ho Chi Minh City',
  };

  // ──────────────────────────────────────────────────────────────────────────
  // §1  COD checkout — paymentUrl must be null/absent
  // ──────────────────────────────────────────────────────────────────────────

  describe('§1 COD checkout', () => {
    beforeEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    afterEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('P-01 returns 201 with correct shape; paymentUrl is null/absent', async () => {
      await addItemToCart();

      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: DELIVERY_ADDRESS, paymentMethod: 'cod' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        orderId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        status: 'pending',
        paymentMethod: 'cod',
        totalAmount: 15000,
        shippingFee: 0,
        createdAt: expect.any(String),
      });
      // COD orders must not carry a payment URL
      expect(res.body.paymentUrl == null).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §2  VNPay checkout — paymentUrl returned, PaymentTransaction created
  // §3  Validate paymentUrl contents
  // ──────────────────────────────────────────────────────────────────────────

  describe('§2–3 VNPay checkout + paymentUrl validation', () => {
    let orderId: string;
    let paymentUrl: string;

    beforeAll(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
      await addItemToCart();

      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: DELIVERY_ADDRESS, paymentMethod: 'vnpay' });

      expect(res.status).toBe(201);
      orderId = res.body.orderId as string;
      paymentUrl = res.body.paymentUrl as string;
    });

    afterAll(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('P-02 checkout response includes orderId and a non-empty paymentUrl', () => {
      expect(orderId).toMatch(/^[0-9a-f-]{36}$/);
      expect(paymentUrl).toBeTruthy();
      expect(typeof paymentUrl).toBe('string');
    });

    it('P-03 paymentUrl points to the VNPay sandbox endpoint', () => {
      expect(paymentUrl).toContain('sandbox.vnpayment.vn');
    });

    it('P-04 paymentUrl contains required vnp_* parameters', () => {
      const url = new URL(paymentUrl);
      const params = url.searchParams;

      expect(params.get('vnp_Version')).toBe('2.1.0');
      expect(params.get('vnp_Command')).toBe('pay');
      expect(params.get('vnp_TmnCode')).toBeTruthy();
      expect(params.get('vnp_Amount')).toBe('1500000'); // 15000 VND × 100
      expect(params.get('vnp_CurrCode')).toBe('VND');
      expect(params.get('vnp_Locale')).toBe('vn');
      expect(params.get('vnp_OrderType')).toBe('250000');
      expect(params.get('vnp_TxnRef')).toMatch(/^[0-9a-f-]{36}$/);
      expect(params.get('vnp_ReturnUrl')).toBeTruthy();
      expect(params.get('vnp_CreateDate')).toMatch(/^\d{14}$/);
      expect(params.get('vnp_ExpireDate')).toMatch(/^\d{14}$/);
    });

    it('P-05 paymentUrl contains a valid vnp_SecureHash (128-char hex)', () => {
      const url = new URL(paymentUrl);
      const hash = url.searchParams.get('vnp_SecureHash');
      expect(hash).toMatch(/^[0-9a-f]{128}$/);
    });

    it('P-06 PaymentTransaction is persisted with status awaiting_ipn', async () => {
      const txnRef = extractTxnRef(paymentUrl);
      const txn = await getPaymentTransaction(txnRef);

      expect(txn).not.toBeNull();
      expect(txn!.status).toBe('awaiting_ipn');
      expect(txn!.orderId).toBe(orderId);
      expect(txn!.amount).toBe(15000);
      expect(txn!.paymentUrl).toBeTruthy();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §4  VNPay return URL — signature verified, DB status reflected
  // ──────────────────────────────────────────────────────────────────────────

  describe('§4 VNPay return URL handler', () => {
    let txnRef: string;

    beforeAll(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
      await addItemToCart();

      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: DELIVERY_ADDRESS, paymentMethod: 'vnpay' });

      expect(res.status).toBe(201);
      txnRef = extractTxnRef(res.body.paymentUrl as string);
    });

    afterAll(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('P-07 returns 200 with signatureValid=true and awaiting_ipn status', async () => {
      const returnParams = buildReturnParams(txnRef, 15000, hashSecret, '00');

      const res = await http
        .get('/api/payments/vnpay/return')
        .query(returnParams);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        txnRef,
        signatureValid: true,
        // IPN has not fired yet → still awaiting_ipn
        status: 'awaiting_ipn',
        vnpResponseCode: '00',
      });
    });

    it('P-08 returns signatureValid=false when signature is tampered', async () => {
      const returnParams = buildReturnParams(txnRef, 15000, hashSecret, '00');
      // Tamper the amount — signature no longer matches
      returnParams['vnp_Amount'] = '9999';

      const res = await http
        .get('/api/payments/vnpay/return')
        .query(returnParams);

      expect(res.status).toBe(200);
      expect(res.body.signatureValid).toBe(false);
    });

    it('P-09 returns status=unknown when vnp_TxnRef is missing', async () => {
      const res = await http
        .get('/api/payments/vnpay/return')
        .query({ vnp_ResponseCode: '00' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('unknown');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §5  VNPay IPN — signature verified, DB updated to completed
  // ──────────────────────────────────────────────────────────────────────────

  describe('§5 VNPay IPN — success path', () => {
    let txnRef: string;
    let orderId: string;

    beforeAll(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
      await addItemToCart();

      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: DELIVERY_ADDRESS, paymentMethod: 'vnpay' });

      expect(res.status).toBe(201);
      orderId = res.body.orderId as string;
      txnRef = extractTxnRef(res.body.paymentUrl as string);
    });

    afterAll(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('P-10 IPN with valid signature returns RspCode=00 + Message=Success', async () => {
      const ipnPayload = buildIpnPayload(txnRef, 15000, hashSecret);

      const res = await http
        .get('/api/payments/vnpay/ipn')
        .query(ipnPayload);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        RspCode: '00',
        Message: expect.any(String),
      });
    });

    it('P-11 PaymentTransaction status transitions to completed after IPN', async () => {
      const txn = await getPaymentTransaction(txnRef);

      expect(txn).not.toBeNull();
      expect(txn!.status).toBe('completed');
      expect(txn!.paidAt).not.toBeNull();
      expect(txn!.providerTxnId).toBe('14069932');
      expect(txn!.vnpResponseCode).toBe('00');
    });

    it('P-12 return URL reflects completed status after IPN processed', async () => {
      const returnParams = buildReturnParams(txnRef, 15000, hashSecret, '00');

      const res = await http
        .get('/api/payments/vnpay/return')
        .query(returnParams);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('completed');
      expect(res.body.orderId).toBe(orderId);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §6  Invalid IPN signature — rejected, no DB mutation
  // ──────────────────────────────────────────────────────────────────────────

  describe('§6 IPN — invalid signature rejection', () => {
    let txnRef: string;

    beforeAll(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
      await addItemToCart();

      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: DELIVERY_ADDRESS, paymentMethod: 'vnpay' });

      expect(res.status).toBe(201);
      txnRef = extractTxnRef(res.body.paymentUrl as string);
    });

    afterAll(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('P-13 tampered amount → RspCode=97 (invalid signature)', async () => {
      const ipnPayload = buildIpnPayload(txnRef, 15000, hashSecret);
      // Tamper the amount AFTER signature was computed — signature now invalid
      ipnPayload['vnp_Amount'] = '99999';

      const res = await http
        .get('/api/payments/vnpay/ipn')
        .query(ipnPayload);

      expect(res.status).toBe(200);
      expect(res.body.RspCode).toBe('97');
    });

    it('P-14 DB transaction remains awaiting_ipn after rejected IPN', async () => {
      const txn = await getPaymentTransaction(txnRef);

      expect(txn).not.toBeNull();
      expect(txn!.status).toBe('awaiting_ipn');
      expect(txn!.paidAt).toBeNull();
    });

    it('P-15 missing vnp_SecureHash → RspCode=97', async () => {
      const ipnPayload = buildIpnPayload(txnRef, 15000, hashSecret);
      delete ipnPayload['vnp_SecureHash'];

      const res = await http
        .get('/api/payments/vnpay/ipn')
        .query(ipnPayload);

      expect(res.status).toBe(200);
      expect(res.body.RspCode).toBe('97');
    });

    it('P-16 wrong secret → RspCode=97', async () => {
      // Build IPN with a different (wrong) secret → signature will not match
      const wrongSecret = 'WRONG_SECRET_THAT_DOES_NOT_MATCH';
      const ipnPayload = buildIpnPayload(txnRef, 15000, wrongSecret);

      const res = await http
        .get('/api/payments/vnpay/ipn')
        .query(ipnPayload);

      expect(res.status).toBe(200);
      expect(res.body.RspCode).toBe('97');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §7  IPN idempotency — second call is acknowledged without re-processing
  // ──────────────────────────────────────────────────────────────────────────

  describe('§7 IPN idempotency', () => {
    let txnRef: string;

    beforeAll(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
      await addItemToCart();

      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: DELIVERY_ADDRESS, paymentMethod: 'vnpay' });

      expect(res.status).toBe(201);
      txnRef = extractTxnRef(res.body.paymentUrl as string);

      // First IPN call — should succeed and set status to completed.
      const ipnPayload = buildIpnPayload(txnRef, 15000, hashSecret, {
        vnp_TransactionNo: 'VNP_IDEM_TEST_001',
      });
      const firstRes = await http
        .get('/api/payments/vnpay/ipn')
        .query(ipnPayload);
      expect(firstRes.body.RspCode).toBe('00');
    });

    afterAll(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('P-17 second IPN call with same txnRef returns RspCode=00 (idempotent)', async () => {
      // VNPay retries IPN — same txnRef but potentially different transactionNo.
      // The handler detects terminal status and acknowledges without re-processing.
      const ipnPayload = buildIpnPayload(txnRef, 15000, hashSecret, {
        vnp_TransactionNo: 'VNP_IDEM_TEST_002', // different provider ID — simulates retry
      });

      const res = await http
        .get('/api/payments/vnpay/ipn')
        .query(ipnPayload);

      expect(res.status).toBe(200);
      expect(res.body.RspCode).toBe('00');
    });

    it('P-18 DB status remains completed after duplicate IPN (no regression)', async () => {
      const txn = await getPaymentTransaction(txnRef);

      expect(txn!.status).toBe('completed');
      // providerTxnId must still be the FIRST IPN's value — not overwritten
      expect(txn!.providerTxnId).toBe('VNP_IDEM_TEST_001');
    });

    it('P-19 version is incremented exactly once (optimistic lock not tripped twice)', async () => {
      const txn = await getPaymentTransaction(txnRef);
      // Version starts at 0 (create) → 1 (awaiting_ipn) → 2 (completed)
      // A second IPN should NOT increment version again (terminal early-exit)
      expect(txn!.version).toBe(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §8  End-to-end full flow verification
  // ──────────────────────────────────────────────────────────────────────────

  describe('§8 Full payment flow: order → paymentUrl → IPN → status updated', () => {
    it('P-20 complete flow: checkout → IPN → verify DB state', async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
      await addItemToCart();

      // Step 1: Checkout with VNPay
      const checkoutRes = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: DELIVERY_ADDRESS, paymentMethod: 'vnpay' });

      expect(checkoutRes.status).toBe(201);
      const orderId = checkoutRes.body.orderId as string;
      const paymentUrl = checkoutRes.body.paymentUrl as string;
      expect(paymentUrl).toBeTruthy();

      const txnRef = extractTxnRef(paymentUrl);

      // Step 2: Verify PaymentTransaction is in awaiting_ipn
      const preTxn = await getPaymentTransaction(txnRef);
      expect(preTxn!.status).toBe('awaiting_ipn');

      // Step 3: Simulate VNPay IPN callback
      const ipnPayload = buildIpnPayload(txnRef, 15000, hashSecret, {
        vnp_TransactionNo: `VNP_FLOW_${Date.now()}`,
      });

      const ipnRes = await http
        .get('/api/payments/vnpay/ipn')
        .query(ipnPayload);

      expect(ipnRes.body.RspCode).toBe('00');

      // Step 4: Verify PaymentTransaction is now completed
      const postTxn = await getPaymentTransaction(txnRef);
      expect(postTxn!.status).toBe('completed');
      expect(postTxn!.paidAt).not.toBeNull();
      expect(postTxn!.orderId).toBe(orderId);

      // Step 5: Return URL now shows completed
      const returnParams = buildReturnParams(txnRef, 15000, hashSecret, '00');
      const returnRes = await http
        .get('/api/payments/vnpay/return')
        .query(returnParams);

      expect(returnRes.body.status).toBe('completed');

      await http.delete('/api/carts/my').set(ownerHeaders());
    });
  });
});
