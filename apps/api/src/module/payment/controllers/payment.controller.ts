import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Query,
} from '@nestjs/common';
import {
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import { ProcessIpnCommand } from '../commands/process-ipn.command';
import { VNPayService } from '../services/vnpay.service';
import { PaymentTransactionRepository } from '../repositories/payment-transaction.repository';
import type { IpnResponse } from '../commands/process-ipn.handler';

/**
 * PaymentController
 *
 * HTTP surface for the Payment BC.
 * Handles two VNPay callbacks:
 *
 *   GET /payments/vnpay/ipn    — Server-to-server (authoritative, updates DB)
 *   GET /payments/vnpay/return — Browser redirect (UI display only, NO DB update)
 *
 * Security note:
 *   Both endpoints are PUBLIC (no auth guard). VNPay's IPN is called server-to-server
 *   and carries no user token. Security relies entirely on HMAC SHA512 signature
 *   verification inside ProcessIpnHandler and verifyReturn().
 *
 * Responsibility split:
 *   - Controller: parse raw query, delegate to command/service, return response.
 *   - ProcessIpnHandler: all business logic, DB writes, event publishing.
 *   - verifyReturn: signature-only check, no state change.
 */
@ApiTags('payments')
@Controller('payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly commandBus: CommandBus,
    private readonly vnpayService: VNPayService,
    private readonly txnRepo: PaymentTransactionRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // Phase 8.3 — IPN (Instant Payment Notification)
  // ---------------------------------------------------------------------------

  /**
   * VNPay IPN endpoint — the SOLE authoritative source for payment status.
   *
   * Called by VNPay's servers (not the browser) after a payment completes
   * or fails. Must respond within 5 seconds or VNPay will retry.
   *
   * Response shape: { RspCode: '00'|'97'|'01'|'04'|'99', Message: string }
   * This exact shape is required by VNPay — do NOT wrap in a result envelope.
   *
   * Endpoint must be PUBLIC — no authentication guard applied.
   * Security is provided by HMAC SHA512 signature verification inside the handler.
   *
   */
  @Get('vnpay/ipn')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleIpn(
    @Query() query: Record<string, string>,
  ): Promise<IpnResponse> {
    this.logger.log(
      `IPN received from VNPay — params: [${Object.keys(query).join(', ')}]`,
    );

    // Delegate entirely to the command handler.
    // No business logic lives in the controller layer.
    return this.commandBus.execute<ProcessIpnCommand, IpnResponse>(
      new ProcessIpnCommand(query),
    );
  }

  // ---------------------------------------------------------------------------
  // Phase 8.4 — Return URL (browser redirect — UI only)
  // ---------------------------------------------------------------------------

  /**
   * VNPay return URL endpoint — browser redirect after the payment page.
   *
   * ⚠️ CRITICAL: This endpoint MUST NOT update the database.
   *
   * This URL is loaded in the customer's browser, meaning the query params
   * could theoretically be tampered with by the customer or a man-in-the-middle.
   * The IPN (above) is the authoritative source of truth.
   *
   * Flow:
   *   1. Optionally verify the signature (recommended — rejects obvious forgeries).
   *   2. Read the current transaction status from DB (reflect what IPN has set).
   *   3. Return orderId + status for the frontend to display the result screen.
   *
   * The frontend should poll for order status separately if the IPN hasn't
   * arrived yet — this endpoint may reflect 'awaiting_ipn' momentarily.
   */
  @Get('vnpay/return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'VNPay return URL — UI display only',
    description:
      'Called when the customer browser is redirected back from VNPay. ' +
      'Returns the current payment status for display purposes only. ' +
      'Does NOT update any state.',
  })
  @ApiOkResponse({
    description: 'Current payment status for the order',
    schema: {
      type: 'object',
      properties: {
        txnRef: { type: 'string', description: 'PaymentTransaction.id' },
        orderId: { type: 'string', description: 'Order UUID' },
        status: {
          type: 'string',
          enum: [
            'pending',
            'awaiting_ipn',
            'completed',
            'failed',
            'refund_pending',
            'refunded',
            'unknown',
          ],
        },
        signatureValid: { type: 'boolean' },
        vnpResponseCode: { type: 'string', nullable: true },
      },
    },
  })
  async handleReturn(
    @Query() query: Record<string, string>,
  ): Promise<ReturnUrlResponse> {
    const txnRef = query['vnp_TxnRef'];

    // -------------------------------------------------------------------------
    // Step 1: Verify signature (defensive — rejects forged return URLs).
    //
    // We log the result but do NOT reject the request even if the signature
    // is invalid. The customer may have bookmarked a stale URL or the link
    // was corrupted in transit. We show them the DB status regardless.
    //
    // However, signatureValid=false is surfaced in the response so the
    // frontend can choose to display a warning or redirect to a support page.
    // -------------------------------------------------------------------------
    const { valid: signatureValid } = this.vnpayService.verifyReturn(query);

    if (!signatureValid) {
      this.logger.warn(
        `Return URL arrived with invalid signature — txnRef=${txnRef ?? 'missing'}. ` +
          `Displaying DB status without state change.`,
      );
    }

    // -------------------------------------------------------------------------
    // Step 2: No txnRef → cannot look up the transaction.
    //
    // Return a safe "unknown" response rather than throwing — the customer
    // browser will display an error screen that guides them to contact support.
    // -------------------------------------------------------------------------
    if (!txnRef) {
      this.logger.warn('Return URL missing vnp_TxnRef parameter.');
      // Use 'unknown' — a missing txnRef means we cannot determine payment
      // outcome. 'failed' would be misleading if the payment actually succeeded
      // and the IPN just hasn't been processed yet.
      return {
        txnRef: '',
        orderId: '',
        status: 'unknown',
        signatureValid,
        vnpResponseCode: query['vnp_ResponseCode'] ?? null,
      };
    }

    // -------------------------------------------------------------------------
    // Step 3: Read current transaction status from DB.
    //
    // This is a READ-ONLY operation. We reflect whatever status the IPN
    // handler has already written. If IPN hasn't arrived yet, the status
    // will be 'awaiting_ipn' — the frontend should handle this gracefully
    // (e.g. "Your payment is being processed, please wait...").
    // -------------------------------------------------------------------------
    const txn = await this.txnRepo.findById(txnRef);

    if (!txn) {
      this.logger.warn(`Return URL references unknown txnRef=${txnRef}.`);
      // 'unknown' is more accurate than 'failed' — the transaction record may
      // not exist due to a race (extremely rare) or a tampered URL that
      // passed signature verification. IPN is authoritative; advise the
      // customer to check their order status page.
      return {
        txnRef,
        orderId: '',
        status: 'unknown',
        signatureValid,
        vnpResponseCode: query['vnp_ResponseCode'] ?? null,
      };
    }

    this.logger.log(
      `Return URL for txnRef=${txnRef} order=${txn.orderId} ` +
        `status=${txn.status} signatureValid=${signatureValid}`,
    );

    return {
      txnRef: txn.id,
      orderId: txn.orderId,
      status: txn.status,
      signatureValid,
      vnpResponseCode: txn.vnpResponseCode ?? query['vnp_ResponseCode'] ?? null,
    };
  }
}

// ---------------------------------------------------------------------------
// Response type — return URL endpoint
// ---------------------------------------------------------------------------

/** Read-only snapshot returned to the browser after VNPay redirects back. */
export interface ReturnUrlResponse {
  /** PaymentTransaction.id (= vnp_TxnRef). */
  txnRef: string;
  /** The orderId linked to this payment transaction. */
  orderId: string;
  /** Current status as stored in the DB — reflects whatever IPN has set. */
  status: string;
  /**
   * Whether the return URL signature was valid.
   * false does NOT mean the payment failed — IPN is authoritative for that.
   * The frontend may display an advisory message when false.
   */
  signatureValid: boolean;
  /**
   * VNPay response code from the return URL (browser-facing).
   * May differ slightly from the IPN value in edge cases.
   * Frontend should use this for display only, not for state decisions.
   */
  vnpResponseCode: string | null;
}
