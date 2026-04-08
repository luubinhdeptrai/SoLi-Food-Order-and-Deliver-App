import { MenuOverview } from "@/features/menu/types";
import { PlusCircle, Leaf } from "lucide-react";

interface MenuSidebarProps {
  overview: MenuOverview;
  onAddItem: () => void;
}

export function MenuSidebar({ overview, onAddItem }: MenuSidebarProps) {
  // Mock data for categories in HTML
  const categories = [
    { name: "Artisan Bakery", icon: "bakery_dining", color: "orange" },
    { name: "Farm Fresh", icon: "nutrition", color: "green" },
    { name: "Fresh Dairy", icon: "water_drop", color: "blue" },
  ];

  return (
    <div className="space-y-6">
      {/* New Item Form / CTA */}
      <div className="bg-primary-container rounded-3xl p-6 text-on-primary-container relative overflow-hidden group">
        <div className="relative z-10">
          <h4 className="font-headline text-xl font-extrabold mb-2">
            New Arrival?
          </h4>
          <p className="text-sm mb-6 opacity-90">
            Expand your digital garden. Add a new menu item in seconds.
          </p>
          <button
            onClick={onAddItem}
            className="w-full bg-on-primary-container text-primary-container py-3 rounded-2xl font-bold flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all"
          >
            <PlusCircle className="w-5 h-5" /> Add Menu Item
          </button>
        </div>
        <div className="absolute -right-4 -bottom-4 opacity-10 group-hover:scale-110 transition-transform duration-500 text-[120px]">
          <Leaf className="w-full h-full" />
        </div>
      </div>

      {/* Menu Stats Card */}
      <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/10">
        <h4 className="font-headline text-lg font-bold mb-4">Menu Overview</h4>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-on-surface-variant">
              Active Items
            </span>
            <span className="text-sm font-bold text-primary bg-primary-fixed px-3 py-1 rounded-full">
              {overview.availableItems || 48}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-on-surface-variant">
              Out of Stock
            </span>
            <span className="text-sm font-bold text-error bg-error-container px-3 py-1 rounded-full">
              {overview.outOfStockItems || 3}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-on-surface-variant">
              Hidden / Drafts
            </span>
            <span className="text-sm font-bold text-on-surface-variant bg-surface-container px-3 py-1 rounded-full">
              12
            </span>
          </div>
          <div className="pt-4 border-t border-outline-variant/10">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-bold text-outline uppercase">
                Inventory Health
              </span>
              <span className="text-xs font-bold text-primary">94%</span>
            </div>
            <div className="w-full bg-surface-container h-2 rounded-full overflow-hidden">
              <div className="bg-primary h-full w-[94%]"></div>
            </div>
          </div>
        </div>
      </div>

      {/* Category Management */}
      <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/10">
        <div className="flex justify-between items-center mb-4">
          <h4 className="font-headline text-lg font-bold">Categories</h4>
          <button className="text-primary text-xs font-bold hover:underline">
            Manage All
          </button>
        </div>
        <div className="space-y-2">
          {categories.map((cat) => (
            <div
              key={cat.name}
              className="flex items-center justify-between p-3 bg-surface rounded-2xl group cursor-pointer hover:bg-stone-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-8 h-8 rounded-lg bg-${cat.color}-100 flex items-center justify-center text-${cat.color}-700`}
                >
                  <span
                    className="material-symbols-outlined text-sm"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    {cat.icon}
                  </span>
                </div>
                <span className="text-sm font-semibold text-on-surface">
                  {cat.name}
                </span>
              </div>
              <span className="material-symbols-outlined text-outline text-lg opacity-40 group-hover:opacity-100">
                drag_indicator
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
