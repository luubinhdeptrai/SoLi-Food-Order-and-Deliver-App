import { Plus, Sprout } from "lucide-react";

interface AddMenuItemCardProps {
  onClick: () => void;
}

export function AddMenuItemCard({ onClick }: AddMenuItemCardProps) {
  return (
    <button
      id="add-menu-item-card"
      onClick={onClick}
      className="group relative rounded-2xl border-2 border-dashed transition-all duration-300 hover:border-primary hover:bg-primary/5 flex flex-col items-center justify-center gap-3 min-h-[280px] w-full cursor-pointer"
      style={{ borderColor: "var(--outline-variant)" }}
    >
      {/* Icon */}
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full transition-all duration-300 group-hover:scale-110"
        style={{ background: "var(--surface-container)" }}
      >
        <Sprout
          className="h-7 w-7 transition-colors duration-300"
          style={{ color: "var(--on-surface-variant)" }}
        />
      </div>

      {/* Text */}
      <div className="text-center px-4">
        <p
          className="font-semibold font-headline text-sm transition-colors duration-300 group-hover:text-primary"
          style={{ color: "var(--on-surface)" }}
        >
          New Arrival?
        </p>
        <p
          className="text-xs mt-1 leading-relaxed"
          style={{ color: "var(--on-surface-variant)" }}
        >
          Expand your digital garden. Add a new menu item in seconds.
        </p>
      </div>

      {/* Add icon */}
      <div
        className="flex h-8 w-8 items-center justify-center rounded-full transition-all duration-300 group-hover:scale-110"
        style={{
          background: "linear-gradient(135deg, #0d631b 0%, #2e7d32 100%)",
        }}
      >
        <Plus className="h-4 w-4 text-white" />
      </div>
    </button>
  );
}
