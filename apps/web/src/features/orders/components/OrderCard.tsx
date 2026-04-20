import { useSortable } from "@dnd-kit/react/sortable";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { Order } from "@/features/orders/types/order.types";
import { Badge } from "@/components/ui/badge";
import type { VariantProps } from "class-variance-authority";
import { badgeVariants } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// ── Tag badge variant mapping ────────────────────────────────────────────────
type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

const TAG_BADGE_VARIANT: Record<string, BadgeVariant> = {
  unaccepted: "order-neutral",
  review: "order-neutral",
  high_priority: "order-priority",
  delivery: "order-delivery",
  preparing: "order-preparing",
  ready: "order-ready",
  ready_pickup: "order-ready",
};

// ── Status icon mapping ───────────────────────────────────────────────────────
type StatusConfig = { icon: string; iconColor: string };

function getStatusConfig(order: Order): StatusConfig {
  if (order.status === "requesting")
    return { icon: "pending", iconColor: "text-outline" };
  if (order.status === "todo") {
    return order.tag.variant === "high_priority"
      ? { icon: "error", iconColor: "text-primary" }
      : { icon: "radio_button_unchecked", iconColor: "text-outline" };
  }
  if (order.status === "in_progress")
    return { icon: "schedule", iconColor: "text-blue-500" };
  return { icon: "check_circle", iconColor: "text-primary" };
}

// ── Left-border accent mapping ────────────────────────────────────────────────
function getBorderAccent(order: Order): string {
  if (order.status === "requesting") return "border-l-4 border-l-outline-variant";
  if (order.status === "in_progress") return "border-l-4 border-l-blue-500";
  if (order.status === "done") return "border-l-4 border-l-primary";
  return "";
}

// ── Component ────────────────────────────────────────────────────────────────
type OrderCardProps = {
  order: Order;
  index?: number;
  isOverlay?: boolean;
};

export function OrderCard({ order, index = 0, isOverlay }: OrderCardProps) {
  const navigate = useNavigate();
  const badgeVariant = TAG_BADGE_VARIANT[order.tag.variant] ?? "order-neutral";
  const statusConfig = getStatusConfig(order);
  const borderAccent = getBorderAccent(order);
  const isOpaque = order.status === "requesting";

  const { ref, handleRef, isDragging } = useSortable({
    id: order.id,
    index,
    type: "order",
    accept: "order",
    group: order.status,
    data: order,
  });

  return (
    <div
      ref={isOverlay ? undefined : ref}
      onClick={() => !isOverlay && navigate(`/orders/${order.id}`)}
      role={!isOverlay ? "button" : undefined}
      tabIndex={!isOverlay ? 0 : undefined}
      onKeyDown={(e) => {
        if (!isOverlay && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          navigate(`/orders/${order.id}`);
        }
      }}
      className={cn(
        // Base card: white surface with subtle bottom separator (no 1px border per design system)
        "bg-surface-container-lowest p-4 rounded-lg",
        "shadow-[0_1px_4px_rgba(0,0,0,0.06)]",
        "transition-all duration-200",
        isOverlay ? "cursor-grabbing shadow-[0_8px_30px_rgba(0,0,0,0.12)] rotate-2" : "hover:-translate-y-0.5 cursor-pointer",
        !isOverlay && "hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]",
        borderAccent,
        (isOpaque || isDragging) && "opacity-80"
      )}
    >
      {/* ── Title row ──────────────────────────────────────────────────── */}
      <div className="flex justify-between items-start mb-2 gap-2">
        <h4 className="text-sm font-medium text-on-surface font-headline leading-snug">
          {order.title}
        </h4>
        {/* Drag handle icon */}
        <button
          className="material-symbols-outlined text-outline-variant text-lg flex-shrink-0 cursor-grab active:cursor-grabbing outline-none"
          ref={handleRef}
          aria-label="Drag handle"
          onClick={(e) => e.stopPropagation()}
        >
          drag_indicator
        </button>
      </div>

      {/* ── Status badge ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 mb-4">
        <Badge variant={badgeVariant}>{order.tag.label}</Badge>
      </div>

      {/* ── Footer: status icon + order number + timestamp / avatar ──────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "material-symbols-outlined text-sm",
              statusConfig.iconColor
            )}
            aria-hidden="true"
          >
            {statusConfig.icon}
          </span>
          <span className="text-xs font-bold text-outline uppercase font-body">
            {order.orderNumber}
          </span>
        </div>

        {/* Right slot: action label | chef avatar | timestamp */}
        {order.statusAction ? (
          <span className="text-[10px] font-bold text-primary uppercase tracking-wide font-body">
            {order.statusAction}
          </span>
        ) : order.assignedTo ? (
          <Avatar size="sm">
            <AvatarImage src={order.assignedTo} alt="Assigned chef" />
            <AvatarFallback>
              <span className="material-symbols-outlined text-xs">person</span>
            </AvatarFallback>
          </Avatar>
        ) : (
          <span className="text-[10px] font-bold text-outline italic font-body">
            {order.timestamp}
          </span>
        )}
      </div>
    </div>
  );
}
