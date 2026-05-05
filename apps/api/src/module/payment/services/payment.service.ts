import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  IPaymentInitiationPort,
} from '@/shared/ports/payment-initiation.port';
import { VNPayService } from './vnpay.service';
import { PaymentTransactionRepository } from '../repositories/payment-transaction.repository';

/**
 * PaymentService
 *
 * Orchestrates the full payment initiation flow for the Payment BC.
 * Implements IPaymentInitiationPort so it can be injected into the
 * Ordering BC via the DIP token PAYMENT_INITIATION_PORT.
 *
 * Flow for VNPay:
 *   1. Create PaymentTransaction with status='pending' (DB first-write guarantee).
 *   2. Build VNPay payment URL (pure computation in VNPayService).
 *   3. Update PaymentTransaction to status='awaiting_ipn' + store URL.
 *   4. Return { txnId, paymentUrl } to PlaceOrderHandler.
 *
 * Failure handling:
 *   - If step 1 fails: DB error is propagated. PlaceOrderHandler will catch and
 *     decide whether to let the order stand with no paymentUrl.
 *   - If step 2/3 fails: PaymentTransaction stays at 'pending'. The caller
 *     (PlaceOrderHandler) logs the error and returns the order without a URL.
 *     PaymentTimeoutTask (Phase 8.5) will expire the 'pending' transaction and
 *     publish PaymentFailedEvent → Ordering BC cancels the order (T-03).
 *     This means the order will self-heal without manual intervention.
 *
 * This class does NOT:
 *   - Call any Ordering BC service or repository.
 *   - Publish domain events directly (events are fired from IPN handler, Phase 8.3).
 */
@Injectable()
export class PaymentService implements IPaymentInitiationPort {
  private readonly logger = new Logger(PaymentService.name);
  private readonly sessionTimeoutMs: number;

  constructor(
    private readonly vnpayService: VNPayService,
    private readonly txnRepo: PaymentTransactionRepository,
    private readonly config: ConfigService,
  ) {
    const timeoutSec = parseInt(
      this.config.get<string>('PAYMENT_SESSION_TIMEOUT_SECONDS', '1800'),
      10,
    );
    this.sessionTimeoutMs = Number.isFinite(timeoutSec) ? timeoutSec * 1_000 : 1_800_000;
  }

  /**
   * @inheritdoc IPaymentInitiationPort.initiateVNPayPayment
   */
  async initiateVNPayPayment(
    orderId: string,
    customerId: string,
    amount: number,
    ipAddr: string,
  ): Promise<{ txnId: string; paymentUrl: string }> {
    const txnId = randomUUID();
    const expiresAt = new Date(Date.now() + this.sessionTimeoutMs);

    // -------------------------------------------------------------------------
    // Step 1: Persist PaymentTransaction in 'pending' state.
    //
    // Writing to DB BEFORE generating the VNPay URL is intentional:
    //   - If this fails, we don't waste a VNPay session.
    //   - The record serves as the idempotency anchor for the entire flow.
    // -------------------------------------------------------------------------
    await this.txnRepo.create({
      id: txnId,
      orderId,
      customerId,
      amount,
      status: 'pending',
      expiresAt,
      version: 0,
    });

    this.logger.log(
      `PaymentTransaction ${txnId} created (pending) for order=${orderId} amount=${amount}`,
    );

    // -------------------------------------------------------------------------
    // Step 2: Generate VNPay redirect URL.
    //
    // VNPayService.buildPaymentUrl() is a pure function — it throws only if
    // config is misconfigured (caught at startup in onModuleInit) or the
    // input params are invalid.
    // -------------------------------------------------------------------------
    const paymentUrl = this.vnpayService.buildPaymentUrl({
      txnRef: txnId,
      amount,
      ipAddr,
    });

    // -------------------------------------------------------------------------
    // Step 3: Transition to 'awaiting_ipn' and store the URL.
    //
    // Uses optimistic locking (version=0). This is safe here because the record
    // was just created and no other process could have incremented the version.
    // If this write fails, the record stays in 'pending'. PaymentTimeoutTask
    // handles recovery automatically (fail-safe, not fail-secure).
    // -------------------------------------------------------------------------
    const updated = await this.txnRepo.updateToAwaitingIpn(txnId, paymentUrl, 0);

    if (!updated) {
      // Log but don't throw: VNPay URL was already generated.
      // The 'pending' record will be expired by PaymentTimeoutTask.
      this.logger.warn(
        `PaymentTransaction ${txnId}: status update to awaiting_ipn failed ` +
          `(optimistic lock mismatch — should not happen at creation time)`,
      );
    } else {
      this.logger.log(
        `PaymentTransaction ${txnId} → awaiting_ipn for order=${orderId}`,
      );
    }

    return { txnId, paymentUrl };
  }
}
