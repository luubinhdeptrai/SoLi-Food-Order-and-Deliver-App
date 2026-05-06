import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CreateMenuItemFooterProps {
  onDiscard: () => void;
  onPublish: () => void;
}

export function CreateMenuItemFooter({
  onDiscard,
  onPublish,
}: CreateMenuItemFooterProps) {
  return (
    <div className="mt-12 flex items-center justify-between bg-card p-6 rounded-3xl shadow-sm border border-border/50">
      <div className="flex items-center gap-4">
        <History className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Draft last saved today at 10:42 AM
        </p>
      </div>
      <div className="flex gap-4">
        <Button
          variant="ghost"
          onClick={onDiscard}
          className="px-6 py-2.5 rounded-full text-muted-foreground font-bold hover:bg-muted/50 transition-colors"
        >
          Discard
        </Button>
        <Button
          onClick={onPublish}
          className="px-10 py-2.5 bg-primary text-primary-foreground rounded-full font-bold shadow-lg shadow-primary/20 active:scale-95 transition-all"
        >
          Publish Item
        </Button>
      </div>
    </div>
  );
}
