import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { OrderItem } from "@/features/orders/types/order.types";

type OrderDetailItemsProps = {
  items: OrderItem[];
};

function formatPrice(value: number) {
  return `$${value.toFixed(2)}`;
}

export function OrderDetailItems({ items }: OrderDetailItemsProps) {
  return (
    <Card
      className="rounded-2xl ring-0 shadow-none bg-surface-container-lowest gap-0 py-0"
      aria-labelledby="order-items-heading"
    >
      {/* Tinted header bar matching Stitch design */}
      <CardHeader className="px-6 py-4 bg-surface-container-low border-b border-outline-variant/10 rounded-t-2xl">
        <CardTitle
          id="order-items-heading"
          className="font-headline font-bold text-lg text-on-surface"
        >
          Order Items
        </CardTitle>
      </CardHeader>

      <CardContent className="p-6">
        <ul className="space-y-6" role="list">
          {items.map((item, index) => (
            <li key={item.id}>
              <div className="flex items-start gap-4">
                {/* Food image thumbnail */}
                <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-surface-container">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-outline">
                      <span
                        className="material-symbols-outlined text-2xl"
                        aria-hidden="true"
                      >
                        restaurant
                      </span>
                    </div>
                  )}
                </div>

                {/* Item details */}
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between gap-2">
                    <h4 className="font-bold text-on-surface font-headline">
                      {item.name}
                    </h4>
                    <span className="font-headline font-bold text-primary flex-shrink-0">
                      {formatPrice(item.price)}
                    </span>
                  </div>
                  <p className="text-sm text-stone-500 mt-1 font-body">
                    Qty: {item.quantity}
                  </p>

                  {item.modifiers && item.modifiers.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.modifiers.map((mod, i) => (
                        <span
                          key={i}
                          className="text-xs px-2 py-1 bg-surface-container rounded-md text-stone-600 font-body"
                        >
                          {mod.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* shadcn Separator between items */}
              {index < items.length - 1 && (
                <Separator className="mt-6 bg-surface-container" />
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
