import { UtensilsCrossed, Leaf } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MenuHeaderProps {
  onAddItem: () => void;
}

export function MenuHeader({ onAddItem }: MenuHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      {/* Title block */}
      <div className="flex items-start gap-3">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl shrink-0"
          style={{
            background: 'linear-gradient(135deg, #0d631b 0%, #2e7d32 100%)',
          }}
        >
          <UtensilsCrossed className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold font-headline text-on-surface leading-tight">
            Menu Management
          </h1>
          <p
            className="text-sm mt-0.5"
            style={{ color: 'var(--on-surface-variant)' }}
          >
            Curate your seasonal offerings and manage live availability.
          </p>
        </div>
      </div>

      {/* Add Item CTA */}
      <Button
        id="add-menu-item-btn"
        onClick={onAddItem}
        className="shrink-0 rounded-full px-5 font-semibold text-sm shadow-sm transition-all hover:brightness-110 hover:scale-[1.02]"
        style={{
          background: 'linear-gradient(135deg, #0d631b 0%, #2e7d32 100%)',
          color: '#ffffff',
        }}
      >
        <Leaf className="mr-2 h-4 w-4" />
        Add New Item
      </Button>
    </div>
  );
}
