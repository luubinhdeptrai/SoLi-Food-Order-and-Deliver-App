import { useParams, Navigate } from "react-router-dom";
import { useOrderStore } from "@/features/orders/stores/orderStore";
import { OrderDetailHeader } from "@/features/orders/components/OrderDetailHeader";
import { OrderDetailItems } from "@/features/orders/components/OrderDetailItems";
import { OrderDetailCustomer } from "@/features/orders/components/OrderDetailCustomer";
import { OrderDetailPayment } from "@/features/orders/components/OrderDetailPayment";
import { OrderDetailHistory } from "@/features/orders/components/OrderDetailHistory";
import { OrderDetailMap } from "@/features/orders/components/OrderDetailMap";
import { OrderDetailNotes } from "@/features/orders/components/OrderDetailNotes";

export function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const orders = useOrderStore((s) => s.orders);
  const order = orders.find((o) => o.id === orderId);

  if (!order) {
    return <Navigate to="/orders" replace />;
  }

  const detail = order.detail;

  return (
    <>
      {/* Page header: back button + order title + action buttons */}
      <OrderDetailHeader order={order} />

      {/* Bento grid — matches Stitch layout: 2/3 + 1/3 on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left column (2/3): items + customer–payment grid ── */}
        <div className="lg:col-span-2 space-y-6">
          {detail?.items && detail.items.length > 0 && (
            <OrderDetailItems items={detail.items} />
          )}

          {/* Customer + Payment side-by-side on md+ */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {detail?.customer && (
              <OrderDetailCustomer customer={detail.customer} />
            )}
            {detail?.totals && detail?.paymentMethod && (
              <OrderDetailPayment
                totals={detail.totals}
                paymentMethod={detail.paymentMethod}
              />
            )}
          </div>
        </div>

        {/* ── Right column (1/3): timeline + map + notes ── */}
        <div className="space-y-6">
          {detail?.history && detail.history.length > 0 && (
            <OrderDetailHistory history={detail.history} />
          )}

          <OrderDetailMap location={detail?.deliveryLocation} />

          {detail?.kitchenNotes && (
            <OrderDetailNotes notes={detail.kitchenNotes} />
          )}
        </div>
      </div>
    </>
  );
}
