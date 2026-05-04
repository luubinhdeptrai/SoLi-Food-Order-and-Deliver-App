import { Injectable, Inject } from '@nestjs/common';
import {
  SQL,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
} from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import * as schema from '@/drizzle/schema';
import {
  orders,
  orderItems,
  orderStatusLogs,
  type Order,
  type OrderItem,
  type OrderStatusLog,
} from '../../order/order.schema';
import type {
  AdminOrderFiltersDto,
  OrderHistoryFiltersDto,
} from '../dto/order-history.dto';

// ---------------------------------------------------------------------------
// Internal row types returned from the repository before DTO mapping
// ---------------------------------------------------------------------------

/**
 * A single row returned by list queries.
 * Extends the core `Order` type with the two aggregated preview fields
 * (itemCount, firstItemName) that are computed via a LATERAL subquery.
 */
export type OrderListRow = Order & {
  itemCount: number;
  firstItemName: string;
};

/**
 * Full detail bundle returned by findDetailById.
 * Three parallel queries are assembled into this shape by the repository.
 */
export type OrderDetailBundle = {
  order: Order;
  items: OrderItem[];
  timeline: OrderStatusLog[];
};

// ---------------------------------------------------------------------------
// Hard limits (avoid magic numbers in query calls)
// ---------------------------------------------------------------------------

/** Maximum rows returned by the shipper "available orders" endpoint. */
const AVAILABLE_FOR_PICKUP_LIMIT = 50;

/**
 * OrderHistoryRepository
 *
 * Read-only repository for the Phase 7 query layer.
 *
 * Design principles:
 *  - Completely separate from Phase 5's OrderRepository (different access patterns,
 *    different SLA). The two share the same underlying tables but serve different
 *    query shapes.
 *  - N+1 eliminated: list queries use a LATERAL aggregate subquery to compute
 *    itemCount and firstItemName in one SQL round-trip, not one per row.
 *  - Detail loads use Promise.all([order, items, timeline]) — 3 parallel queries,
 *    never sequential.
 *  - Pagination: two-query pattern (data page + COUNT) run via Promise.all.
 *  - Dynamic filters constructed with Drizzle's `and(...)` + undefined conditions
 *    so that unused filters are cleanly excluded from the WHERE clause.
 *
 * Phase: 7
 */
@Injectable()
export class OrderHistoryRepository {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  // ---------------------------------------------------------------------------
  // Customer: paginated list of their own orders
  // ---------------------------------------------------------------------------

  async findByCustomer(
    customerId: string,
    filters: OrderHistoryFiltersDto,
  ): Promise<{ data: OrderListRow[]; total: number }> {
    const where = and(
      eq(orders.customerId, customerId),
      ...this.buildDateAndStatusConditions(filters),
    );
    return this.paginatedListQuery(where, filters);
  }

  // ---------------------------------------------------------------------------
  // Restaurant: paginated list of orders placed at their restaurant
  // ---------------------------------------------------------------------------

  /**
   * Fetch orders belonging to the restaurant owned by `ownerId`.
   * The caller (OrderHistoryService) has already resolved that a snapshot exists
   * and obtained the restaurantId; we accept restaurantId here directly.
   */
  async findByRestaurantId(
    restaurantId: string,
    filters: OrderHistoryFiltersDto,
  ): Promise<{ data: OrderListRow[]; total: number }> {
    const where = and(
      eq(orders.restaurantId, restaurantId),
      ...this.buildDateAndStatusConditions(filters),
    );
    return this.paginatedListQuery(where, filters);
  }

  /**
   * Kitchen operational view: all active orders for this restaurant,
   * sorted oldest-first (highest preparation priority).
   * No pagination — expected to be a short live list (< 100 orders).
   */
  async findActiveByRestaurantId(
    restaurantId: string,
  ): Promise<OrderListRow[]> {
    const activeStatuses = [
      'confirmed',
      'preparing',
      'ready_for_pickup',
    ] as const;
    const where = and(
      eq(orders.restaurantId, restaurantId),
      inArray(orders.status, activeStatuses),
    );
    return this.listQueryWithAggregates(
      where,
      asc(orders.createdAt),
      undefined,
    );
  }

  // ---------------------------------------------------------------------------
  // Shipper: available, active, and history
  // ---------------------------------------------------------------------------

  /**
   * All orders in ready_for_pickup state.
   * Hard-capped at AVAILABLE_FOR_PICKUP_LIMIT rows (no pagination).
   * No actor filter — any authenticated shipper can view and claim these.
   */
  async findAvailableForPickup(): Promise<OrderListRow[]> {
    const where = eq(orders.status, 'ready_for_pickup');
    return this.listQueryWithAggregates(
      where,
      asc(orders.createdAt),
      AVAILABLE_FOR_PICKUP_LIMIT,
    );
  }

  /**
   * The shipper's current in-progress delivery (picked_up or delivering).
   * Returns at most 1 row — business assumption: one active delivery at a time.
   */
  async findActiveForShipper(shipperId: string): Promise<OrderListRow[]> {
    const where = and(
      eq(orders.shipperId, shipperId),
      inArray(orders.status, ['picked_up', 'delivering']),
    );
    return this.listQueryWithAggregates(where, desc(orders.updatedAt), 1);
  }

  /**
   * The shipper's delivered order history, paginated.
   */
  async findDeliveredByShipper(
    shipperId: string,
    filters: OrderHistoryFiltersDto,
  ): Promise<{ data: OrderListRow[]; total: number }> {
    const where = and(
      eq(orders.shipperId, shipperId),
      eq(orders.status, 'delivered'),
      ...this.buildDateAndStatusConditions({ ...filters, status: undefined }),
    );
    return this.paginatedListQuery(where, filters);
  }

  // ---------------------------------------------------------------------------
  // Admin: full platform view with composable filters
  // ---------------------------------------------------------------------------

  async findAll(
    filters: AdminOrderFiltersDto,
  ): Promise<{ data: OrderListRow[]; total: number }> {
    const where = and(
      filters.restaurantId
        ? eq(orders.restaurantId, filters.restaurantId)
        : undefined,
      filters.customerId
        ? eq(orders.customerId, filters.customerId)
        : undefined,
      filters.shipperId ? eq(orders.shipperId, filters.shipperId) : undefined,
      filters.paymentMethod
        ? eq(orders.paymentMethod, filters.paymentMethod)
        : undefined,
      ...this.buildDateAndStatusConditions(filters),
    );

    // Resolve sort column — defence against unexpected values (DTO enum validates input)
    const sortColumn =
      filters.sortBy === 'updated_at'
        ? orders.updatedAt
        : filters.sortBy === 'total_amount'
          ? orders.totalAmount
          : orders.createdAt;

    const orderBy =
      (filters.sortOrder ?? 'desc') === 'asc'
        ? asc(sortColumn)
        : desc(sortColumn);

    return this.paginatedListQuery(where, filters, orderBy);
  }

  // ---------------------------------------------------------------------------
  // Detail: single order + items + timeline (used by customer and admin)
  // ---------------------------------------------------------------------------

  /**
   * Load full order detail in three parallel queries.
   * Returns null when the order does not exist.
   */
  async findDetailById(orderId: string): Promise<OrderDetailBundle | null> {
    const [order, items, timeline] = await Promise.all([
      this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1),
      this.db.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
      this.db
        .select()
        .from(orderStatusLogs)
        .where(eq(orderStatusLogs.orderId, orderId))
        .orderBy(asc(orderStatusLogs.createdAt)),
    ]);

    if (!order[0]) return null;
    return { order: order[0], items, timeline };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Run a paginated list query (data page + total count) in parallel.
   * `orderBy` defaults to newest-first (`created_at DESC`).
   */
  private async paginatedListQuery(
    where: ReturnType<typeof and>,
    filters: Pick<OrderHistoryFiltersDto, 'limit' | 'offset'>,
    orderBy: SQL = desc(orders.createdAt),
  ): Promise<{ data: OrderListRow[]; total: number }> {
    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;

    const [data, totalResult] = await Promise.all([
      this.listQueryWithAggregates(where, orderBy, limit, offset),
      this.db.select({ value: count() }).from(orders).where(where),
    ]);

    return { data, total: totalResult[0]?.value ?? 0 };
  }

  /**
   * Core list query that attaches itemCount and firstItemName via a LATERAL
   * subquery. This eliminates the N+1 problem — one SQL round-trip regardless
   * of how many orders are on the page.
   *
   * Drizzle does not have first-class LATERAL JOIN support, so we use a
   * correlated scalar subquery for each aggregate via sql`...`. This is
   * semantically identical to a LATERAL subquery and produces the same plan.
   */
  private async listQueryWithAggregates(
    where: ReturnType<typeof and>,
    orderBy: SQL,
    limit?: number,
    offset?: number,
  ): Promise<OrderListRow[]> {
    // Build the base query with the correlated subqueries injected as
    // extra SELECT expressions. Drizzle's `extras` field in select() is not
    // available in the node-postgres driver version used here, so we compose
    // the full SELECT via db.select({...}).from(orders).
    const query = this.db
      .select({
        // All columns from the orders table
        id: orders.id,
        customerId: orders.customerId,
        restaurantId: orders.restaurantId,
        restaurantName: orders.restaurantName,
        cartId: orders.cartId,
        status: orders.status,
        totalAmount: orders.totalAmount,
        shippingFee: orders.shippingFee,
        estimatedDeliveryMinutes: orders.estimatedDeliveryMinutes,
        paymentMethod: orders.paymentMethod,
        deliveryAddress: orders.deliveryAddress,
        note: orders.note,
        paymentUrl: orders.paymentUrl,
        expiresAt: orders.expiresAt,
        version: orders.version,
        shipperId: orders.shipperId,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        // Correlated aggregate subqueries — 1 extra SQL expr per list row resolved
        // in a single query plan, not N separate round-trips.
        itemCount: sql<number>`(
          SELECT COUNT(*)::int
          FROM order_items oi
          WHERE oi.order_id = ${orders.id}
        )`,
        firstItemName: sql<string>`(
          SELECT MIN(oi.item_name)
          FROM order_items oi
          WHERE oi.order_id = ${orders.id}
        )`,
      })
      .from(orders)
      .where(where)
      .orderBy(orderBy);

    if (limit !== undefined) {
      query.limit(limit);
    }
    if (offset !== undefined) {
      query.offset(offset);
    }

    return (await query) as OrderListRow[];
  }

  /**
   * Build the reusable WHERE conditions that filter by status and date range.
   * Returning `undefined` conditions from `and(...)` is valid — Drizzle ignores them.
   */
  private buildDateAndStatusConditions(
    filters: Pick<OrderHistoryFiltersDto, 'status' | 'from' | 'to'>,
  ) {
    return [
      filters.status ? eq(orders.status, filters.status) : undefined,
      filters.from ? gte(orders.createdAt, new Date(filters.from)) : undefined,
      filters.to ? lte(orders.createdAt, new Date(filters.to)) : undefined,
    ] as const;
  }
}
