import type { Order } from "@/features/orders/types/order.types";
import { cn } from "@/lib/utils";

type TagVariantConfig = {
  bg: string;
  text: string;
};

const tagVariants: Record<string, TagVariantConfig> = {
  unaccepted: { bg: "bg-[#eeeeee]", text: "text-[#40493d]" },
  review: { bg: "bg-[#eeeeee]", text: "text-[#40493d]" },
  high_priority: { bg: "bg-green-100", text: "text-green-800" },
  delivery: { bg: "bg-amber-100", text: "text-amber-700" },
  preparing: { bg: "bg-blue-50", text: "text-blue-600" },
  ready: { bg: "bg-green-100", text: "text-green-800" },
  ready_pickup: { bg: "bg-green-100", text: "text-green-800" },
};

type StatusIndicatorConfig = {
  icon: string;
  iconColor: string;
};

const statusIndicators: Record<string, StatusIndicatorConfig> = {
  requesting: { icon: "pending", iconColor: "text-[#707a6c]" },
  todo_high: { icon: "error", iconColor: "text-[#0d631b]" },
  todo_normal: { icon: "radio_button_unchecked", iconColor: "text-[#707a6c]" },
  in_progress: { icon: "schedule", iconColor: "text-blue-500" },
  done: { icon: "check_circle", iconColor: "text-[#0d631b]" },
};

type BorderAccentConfig = {
  borderClass: string;
};

const borderAccents: Record<string, BorderAccentConfig> = {
  requesting: { borderClass: "border-l-4 border-l-[#bfcaba]" },
  todo_high: { borderClass: "" },
  todo_normal: { borderClass: "" },
  in_progress: { borderClass: "border-l-4 border-l-blue-500" },
  done: { borderClass: "border-l-4 border-l-[#0d631b]" },
};

type OrderCardProps = {
  order: Order;
  onDragStart?: (e: React.DragEvent, orderId: string) => void;
};

function getStatusKey(order: Order): string {
  if (order.status === "requesting") return "requesting";
  if (order.status === "todo") {
    return order.tag.variant === "high_priority" ? "todo_high" : "todo_normal";
  }
  if (order.status === "in_progress") return "in_progress";
  return "done";
}

export function OrderCard({ order, onDragStart }: OrderCardProps) {
  const tagConfig = tagVariants[order.tag.variant] ?? tagVariants.unaccepted;
  const statusKey = getStatusKey(order);
  const statusConfig = statusIndicators[statusKey];
  const borderConfig = borderAccents[statusKey];
  const isOpaque = order.status === "requesting";

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart?.(e, order.id)}
      className={cn(
        "bg-white p-4 rounded-lg shadow-sm border-b border-[#eeeeee] transition-all duration-200 cursor-grab active:cursor-grabbing hover:-translate-y-0.5 hover:shadow-md",
        borderConfig.borderClass,
        isOpaque && "opacity-80"
      )}
    >
      {/* Title row */}
      <div className="flex justify-between items-start mb-2">
        <h4 className="text-sm font-medium text-[#1a1c1c] font-['Plus_Jakarta_Sans'] leading-snug pr-2">
          {order.title}
        </h4>
        <span className="material-symbols-outlined text-[#bfcaba] text-lg flex-shrink-0">
          drag_indicator
        </span>
      </div>

      {/* Tag badge */}
      <div className="flex flex-wrap gap-1 mb-4">
        <span
          className={cn(
            "text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wide",
            tagConfig.bg,
            tagConfig.text
          )}
        >
          {order.tag.label}
        </span>
      </div>

      {/* Footer row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("material-symbols-outlined text-sm", statusConfig.iconColor)}>
            {statusConfig.icon}
          </span>
          <span className="text-xs font-bold text-[#707a6c] uppercase font-['Inter']">
            {order.orderNumber}
          </span>
        </div>

        {order.statusAction ? (
          <span className="text-[10px] font-bold text-[#0d631b] uppercase tracking-wide">
            {order.statusAction}
          </span>
        ) : order.assignedTo ? (
          <div className="w-6 h-6 rounded-full bg-[#eeeeee] overflow-hidden ring-1 ring-white">
            <img
              src={order.assignedTo}
              alt="Chef"
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <span className="text-[10px] font-bold text-[#707a6c] italic font-['Inter']">
            {order.timestamp}
          </span>
        )}
      </div>
    </div>
  );
}
