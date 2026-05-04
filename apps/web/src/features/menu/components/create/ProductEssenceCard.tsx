import { Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function ProductEssenceCard() {
  return (
    <div className="bg-card rounded-3xl p-8 shadow-sm border border-border/50">
      <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
        <Info className="h-5 w-5 text-primary" />
        Product Essence
      </h3>
      <div className="space-y-6">
        <div className="space-y-2">
          <Label
            htmlFor="item-name"
            className="text-sm font-bold text-muted-foreground"
          >
            Item Name
          </Label>
          <Input
            id="item-name"
            placeholder="e.g. Heirloom Tomato Tart"
            className="w-full bg-surface-container border-none rounded-xl px-4 py-6 focus:ring-2 focus:ring-primary/30 focus:bg-card transition-all outline-none"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label
              htmlFor="category"
              className="text-sm font-bold text-muted-foreground"
            >
              Category Selection
            </Label>
            <Select>
              <SelectTrigger
                id="category"
                className="w-full h-12 bg-surface-container border-none rounded-xl px-4 focus:ring-2 focus:ring-primary/30 focus:bg-card transition-all outline-none"
              >
                <SelectValue placeholder="Select Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="artisan-bakery">Artisan Bakery</SelectItem>
                <SelectItem value="farm-fresh">Farm Fresh</SelectItem>
                <SelectItem value="fresh-dairy">Fresh Dairy</SelectItem>
                <SelectItem value="handcrafted-pantry">
                  Handcrafted Pantry
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="price"
              className="text-sm font-bold text-muted-foreground"
            >
              Price
            </Label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">
                $
              </span>
              <Input
                id="price"
                type="number"
                placeholder="0.00"
                className="w-full h-12 bg-surface-container border-none rounded-xl pl-8 pr-4 focus:ring-2 focus:ring-primary/30 focus:bg-card transition-all outline-none"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label
            htmlFor="description"
            className="text-sm font-bold text-muted-foreground"
          >
            Description
          </Label>
          <Textarea
            id="description"
            placeholder="Describe the flavors, origin, and craftsmanship..."
            className="w-full min-h-[120px] bg-surface-container border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/30 focus:bg-card transition-all outline-none resize-none"
          />
        </div>
      </div>
    </div>
  );
}
