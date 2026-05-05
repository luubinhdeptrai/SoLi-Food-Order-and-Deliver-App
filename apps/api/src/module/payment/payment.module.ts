import { Global, Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@/drizzle/drizzle.module';
import { vnpayConfig } from '@/config/vnpay.config';
import { PAYMENT_INITIATION_PORT } from '@/shared/ports/payment-initiation.port';
import { VNPayService } from './services/vnpay.service';
import { PaymentService } from './services/payment.service';
import { PaymentTransactionRepository } from './repositories/payment-transaction.repository';
import { PaymentController } from './controllers/payment.controller';
import { ProcessIpnHandler } from './commands/process-ipn.handler';
import { PaymentTimeoutTask } from './tasks/payment-timeout.task';
import { OrderCancelledAfterPaymentHandler } from './events/order-cancelled-after-payment.handler';

/**
 * PaymentModule — Phase 8 implementation.
 *
 * This module is marked @Global() so PAYMENT_INITIATION_PORT is injectable
 * everywhere in the application without requiring explicit module imports.
 * This is the same pattern used by RedisModule (see redis.module.ts).
 *
 * The @Global() decorator is justified here because:
 *   - The Ordering BC's PlaceOrderHandler needs to call into Payment without
 *     creating a direct module dependency (DIP / D-P5).
 *   - The port token PAYMENT_INITIATION_PORT is the only cross-BC coupling point.
 *   - AppModule imports PaymentModule exactly once (required for @Global() modules).
 *
 * Providers:
 *   VNPayService                        — pure VNPay adapter (URL build + IPN verify)
 *   PaymentService                      — orchestrates payment initiation; implements IPaymentInitiationPort
 *   PaymentTransactionRepository        — Drizzle queries for payment_transactions
 *   ProcessIpnHandler                   — CQRS command handler for VNPay IPN (Phase 8.3)
 *   PaymentTimeoutTask                  — Cron job expiring stale pending/awaiting_ipn txns (Phase 8.5)
 *   OrderCancelledAfterPaymentHandler   — Event handler initiating refund flow (Phase 8.6)
 *   PAYMENT_INITIATION_PORT             — DI token bound to PaymentService via useExisting
 *
 * Controllers:
 *   PaymentController  — GET /payments/vnpay/ipn + GET /payments/vnpay/return + GET /payments/my
 *
 * Exports:
 *   PaymentService             — available globally (e.g. for future PaymentController)
 *   PAYMENT_INITIATION_PORT    — available globally (injected in PlaceOrderHandler)
 *
 * Note: ScheduleModule.forRoot() is imported once in AppModule — cron decorators
 * work automatically in all providers without re-importing ScheduleModule here.
 */
@Global()
@Module({
  imports: [CqrsModule, DatabaseModule, ConfigModule.forFeature(vnpayConfig)],
  controllers: [PaymentController],
  providers: [
    VNPayService,
    PaymentService,
    PaymentTransactionRepository,
    ProcessIpnHandler,
    PaymentTimeoutTask,
    OrderCancelledAfterPaymentHandler,
    {
      provide: PAYMENT_INITIATION_PORT,
      useExisting: PaymentService,
    },
  ],
  exports: [PaymentService, PAYMENT_INITIATION_PORT],
})
export class PaymentModule {}
