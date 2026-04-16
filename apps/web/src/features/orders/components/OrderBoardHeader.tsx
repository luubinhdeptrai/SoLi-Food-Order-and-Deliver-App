import { useOrderStore } from "@/features/orders/stores/orderStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type OrderBoardHeaderProps = {
  onRelease?: () => void;
};

export function OrderBoardHeader({ onRelease }: OrderBoardHeaderProps) {
  const { searchQuery, setSearchQuery } = useOrderStore();

  return (
    <div className="mb-6 flex justify-between items-center flex-shrink-0">
      <h2 className="text-2xl font-extrabold text-on-surface tracking-tight font-headline">
        Board
      </h2>

      <div className="flex gap-2 items-center">
        {/* Search / quick filter — shadcn Input with leading icon */}
        <div className="relative">
          <span
            className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none"
            aria-hidden="true"
          >
            search
          </span>
          <Input
            type="text"
            placeholder="Quick Filters"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 w-48 bg-surface-container-lowest shadow-sm border-none focus-visible:ring-2 focus-visible:ring-primary/20"
          />
        </div>

        {/* Release button — shadcn outline Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={onRelease}
          className="font-bold text-on-surface-variant shadow-sm"
        >
          Release
        </Button>

        {/* More options — shadcn ghost icon Button */}
        <Button
          variant="ghost"
          size="icon"
          aria-label="More options"
          className="text-muted-foreground"
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            more_horiz
          </span>
        </Button>
      </div>
    </div>
  );
}
