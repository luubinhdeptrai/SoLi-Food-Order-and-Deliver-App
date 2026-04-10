import { Eye, Lightbulb } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export function MarketVisibilityCard() {
  return (
    <div className="bg-card rounded-3xl p-8 shadow-sm border border-border/50">
      <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
        <Eye className="h-5 w-5 text-primary" />
        Market Visibility
      </h3>
      <div className="flex items-center justify-between p-4 bg-muted/30 rounded-2xl">
        <div>
          <p className="font-bold text-foreground">Live Availability</p>
          <p className="text-xs text-muted-foreground">Enable for public viewing</p>
        </div>
        <Switch defaultChecked className="data-[state=checked]:bg-primary" />
      </div>
      <div className="mt-8 space-y-4">
        <div className="flex items-start gap-3 p-4 bg-accent/10 rounded-2xl border border-accent/20">
          <Lightbulb className="h-5 w-5 text-accent mt-0.5 shrink-0" />
          <p className="text-xs text-accent-foreground leading-relaxed">
            <span className="font-bold">Pro Tip:</span> Items with high-quality
            photos sell 40% faster in the Artisan Bakery category.
          </p>
        </div>
      </div>
    </div>
  );
}
