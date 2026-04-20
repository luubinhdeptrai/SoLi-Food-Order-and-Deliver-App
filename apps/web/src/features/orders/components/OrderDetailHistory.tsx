import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { OrderHistoryEvent } from "@/features/orders/types/order.types";

type OrderDetailHistoryProps = {
  history: OrderHistoryEvent[];
};

export function OrderDetailHistory({ history }: OrderDetailHistoryProps) {
  return (
    <Card className="rounded-2xl ring-0 shadow-none bg-surface-container-lowest gap-0 py-0">
      <CardHeader className="px-6 pt-6 pb-0">
        <CardTitle className="font-headline font-bold text-lg text-on-surface">
          Order History
        </CardTitle>
      </CardHeader>

      <CardContent className="px-6 pb-6 pt-6">
        {/* Timeline — CSS before pseudo-element draws the vertical connecting line */}
        <div className="relative space-y-8 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-0.5 before:bg-surface-container">
          {history.map((event, index) => {
            const isCompleted = event.step === "completed";
            const isCurrent = event.step === "current";
            const isPending = event.step === "pending";

            return (
              <div
                key={index}
                className={cn(
                  "relative flex gap-4 pl-8",
                  isPending && "opacity-40"
                )}
              >
                {/* Completed dot: primary-fixed ring, primary fill */}
                {isCompleted && (
                  <div
                    className="absolute left-0 top-1 w-6 h-6 rounded-full bg-primary-fixed flex items-center justify-center z-10"
                    aria-hidden="true"
                  >
                    <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                  </div>
                )}

                {/* Current dot: white border, pulsing primary */}
                {isCurrent && (
                  <div
                    className="absolute left-0 top-1 w-6 h-6 rounded-full bg-white border-2 border-primary flex items-center justify-center z-10"
                    aria-hidden="true"
                  >
                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  </div>
                )}

                {/* Pending dot: stone/greyed out */}
                {isPending && (
                  <div
                    className="absolute left-0 top-1 w-6 h-6 rounded-full bg-stone-200 flex items-center justify-center z-10"
                    aria-hidden="true"
                  >
                    <div className="w-2.5 h-2.5 rounded-full bg-stone-400" />
                  </div>
                )}

                <div>
                  <p
                    className={cn(
                      "text-sm font-bold font-headline",
                      isCurrent ? "text-primary" : "text-on-surface"
                    )}
                  >
                    {event.label}
                  </p>
                  <p className="text-xs text-stone-500 font-body">{event.time}</p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
