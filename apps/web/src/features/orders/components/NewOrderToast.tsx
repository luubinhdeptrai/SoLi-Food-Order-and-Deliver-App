import { useEffect, useState } from "react";
import { useOrderStore } from "@/features/orders/stores/orderStore";
import { Button } from "@/components/ui/button";

export function NewOrderToast() {
  const { newOrderToast, acceptOrder, dismissToast } = useOrderStore();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (newOrderToast) {
      const t = setTimeout(() => setVisible(true), 100);
      return () => clearTimeout(t);
    } else {
      setVisible(false);
    }
  }, [newOrderToast]);

  if (!newOrderToast) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={[
        "fixed bottom-6 right-6 z-50 max-w-sm w-full",
        "bg-surface-container-lowest rounded-xl",
        "shadow-[0_8px_32px_rgba(0,0,0,0.14)]",
        "border-l-8 border-primary",
        "p-5 transition-all duration-500",
        visible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0",
      ].join(" ")}
      style={{ animation: "subtleBounce 3s ease-in-out infinite" }}
    >
      <div className="flex gap-4">
        {/* Notification icon */}
        <div className="w-12 h-12 bg-surface-container rounded-full flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-primary" aria-hidden="true">
            notifications_active
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-on-surface font-headline">
            New Order {newOrderToast.orderNumber}
          </h3>
          <p className="text-sm text-muted-foreground mb-4 font-body">
            {(() => {
              const itemCount = newOrderToast.detail?.items?.length ?? 0;
              const total = newOrderToast.detail?.totals?.total;
              const itemLabel = itemCount === 1 ? "item" : "items";
              const totalStr =
                total != null
                  ? `$${total.toFixed(2)} total`
                  : "";
              return itemCount > 0
                ? `${itemCount} ${itemLabel}${totalStr ? ` • ${totalStr}` : ""}`
                : totalStr || "New order received";
            })()}
          </p>

          {/* Action buttons — shadcn Button */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={dismissToast}
              className="flex-1 uppercase tracking-wide font-bold"
            >
              Later
            </Button>
            <Button
              size="sm"
              onClick={() => acceptOrder(newOrderToast.id)}
              className="flex-1 uppercase tracking-wide font-bold bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Accept
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
