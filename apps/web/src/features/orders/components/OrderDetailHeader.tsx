import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Order } from "@/features/orders/types/order.types";


type OrderDetailHeaderProps = {
  order: Order;
};

// Map tag variant -> order badge variant (already defined in badge.tsx)
const TAG_TO_BADGE: Record<string, "order-neutral" | "order-priority" | "order-delivery" | "order-preparing" | "order-ready"> = {
  unaccepted: "order-neutral",
  review: "order-neutral",
  high_priority: "order-priority",
  delivery: "order-delivery",
  preparing: "order-preparing",
  ready: "order-ready",
  ready_pickup: "order-ready",
};

export function OrderDetailHeader({ order }: OrderDetailHeaderProps) {
  const badgeVariant = TAG_TO_BADGE[order.tag.variant] ?? "order-neutral";

  return (
    <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
      {/* Left: back link + title + timestamp */}
      <div className="space-y-1">
        <Link
          to="/orders"
          className="inline-flex items-center gap-2 text-primary font-headline font-bold text-sm mb-4 hover:opacity-80 transition-opacity w-fit"
        >
          <span className="material-symbols-outlined text-lg" aria-hidden="true">
            arrow_back
          </span>
          Back to Board
        </Link>

        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-extrabold text-on-surface tracking-tight font-headline">
            Order {order.orderNumber}
          </h1>
          {/* Keep the Stitch-exact pill style via className override on Badge */}
          <Badge
            variant={badgeVariant}
            className="px-3 py-1 h-auto rounded-full text-xs font-bold uppercase tracking-wider"
          >
            {order.tag.label}
          </Badge>
        </div>

        {order.detail?.placedAt && (
          <p className="text-stone-500 font-medium font-body">
            Placed on {order.detail.placedAt}
          </p>
        )}
      </div>

      {/* Right: action buttons */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          className="rounded-full border-outline-variant text-primary font-bold hover:bg-surface-container hover:text-primary px-6 py-2.5 h-auto"
        >
          Print Receipt
        </Button>
        <Button
          className="rounded-full bg-secondary-container text-on-secondary-container font-bold shadow-sm hover:brightness-95 active:scale-95 px-6 py-2.5 h-auto"
        >
          Mark as Ready
        </Button>
      </div>
    </header>
  );
}
