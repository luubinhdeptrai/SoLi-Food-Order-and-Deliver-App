import { Button } from '@/components/ui/button';

interface CreateMenuItemHeaderProps {
  onCancel: () => void;
  onSave: () => void;
}

export function CreateMenuItemHeader({
  onCancel,
  onSave,
}: CreateMenuItemHeaderProps) {
  return (
    <div className="flex items-end justify-between mb-10">
      <div>
        <h1 className="text-4xl font-extrabold text-foreground tracking-tight">
          Create New Item
        </h1>
        <p className="text-muted-foreground mt-2 text-lg">
          Add a fresh addition to your market offerings.
        </p>
      </div>
      <div className="flex gap-4">
        <Button
          variant="ghost"
          onClick={onCancel}
          className="px-6 py-3 rounded-full text-muted-foreground font-bold hover:bg-muted/50 transition-colors"
        >
          Cancel
        </Button>
        <Button
          onClick={onSave}
          className="px-8 py-3 editorial-gradient text-primary-foreground rounded-full font-bold shadow-lg shadow-primary/20 active:scale-95 transition-all"
        >
          Save Item
        </Button>
      </div>
    </div>
  );
}
