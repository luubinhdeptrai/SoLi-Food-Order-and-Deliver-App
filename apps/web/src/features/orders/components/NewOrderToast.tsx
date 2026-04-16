import { useEffect, useState } from "react";
import { useOrderStore } from "@/features/orders/stores/orderStore";

export function NewOrderToast() {
  const { newOrderToast, acceptOrder, dismissToast } = useOrderStore();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (newOrderToast) {
      // Small delay for animation
      const t = setTimeout(() => setVisible(true), 100);
      return () => clearTimeout(t);
    } else {
      setVisible(false);
    }
  }, [newOrderToast]);

  if (!newOrderToast) return null;

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 max-w-sm w-full bg-white rounded-xl shadow-2xl border-l-8 border-[#0d631b] p-5 transition-all duration-500 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
      }`}
      style={{ animation: "subtleBounce 3s ease-in-out infinite" }}
    >
      <div className="flex gap-4">
        {/* Icon */}
        <div className="w-12 h-12 bg-[#f3f3f3] rounded-full flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-[#0d631b]">
            notifications_active
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-[#1a1c1c] font-['Plus_Jakarta_Sans']">
            New Order {newOrderToast.orderNumber}
          </h3>
          <p className="text-sm text-[#707a6c] mb-4 font-['Inter']">
            4 items • $54.20 total
          </p>
          <div className="flex gap-2">
            <button
              onClick={dismissToast}
              className="flex-1 bg-[#eeeeee] text-[#40493d] font-bold py-2 rounded-xl text-xs uppercase tracking-wide hover:bg-[#e2e2e2] active:scale-95 transition-all font-['Inter']"
            >
              Later
            </button>
            <button
              onClick={() => acceptOrder(newOrderToast.id)}
              className="flex-1 bg-[#0d631b] text-white font-bold py-2 rounded-xl text-xs uppercase tracking-wide hover:bg-[#2e7d32] active:scale-95 transition-all font-['Inter']"
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
