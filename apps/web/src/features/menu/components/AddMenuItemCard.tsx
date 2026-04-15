import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
interface AddMenuItemCardProps {
  onClick: () => void;
}

export function AddMenuItemCard({ onClick }: AddMenuItemCardProps) {
  return (
    <Card className="bg-primary-container rounded-3xl relative overflow-hidden min-h-[180px] py-0 gap-0 ring-0">
      {/* Decorative leaf/shape in background if needed, but keeping it simple first */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/20 rounded-full -mr-16 -mt-16 blur-3xl" />

      <CardContent className="p-6 flex flex-col gap-4 justify-center">
        <div className="space-y-2 z-10">
          <h3 className="text-white text-2xl font-bold font-headline">
            New Arrival?
          </h3>
          <p className="text-white/90 font-medium leading-relaxed">
            Expand your digital garden. Add a new menu item in seconds.
          </p>
        </div>

        <Button
          onClick={onClick}
          size="lg"
          className="z-10 mt-2 bg-primary-200 hover:bg-primary-300 text-primary px-4 py-4 rounded-2xl flex items-center justify-center gap-2 font-bold transition-all active:scale-95 shadow-sm"
        >
          <PlusCircle className="h-5 w-5" />
          <span>Add Menu Item</span>
        </Button>
      </CardContent>
    </Card>
  );
}
