import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
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
import { Leaf, DollarSign, Tag, FileText } from 'lucide-react';
import type { MenuItemCategory } from '@/features/menu/types';

interface AddMenuItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit?: (data: {
    name: string;
    description: string;
    price: string;
    sku: string;
    category: MenuItemCategory;
  }) => void;
}

const CATEGORIES: { value: MenuItemCategory; label: string }[] = [
  { value: 'salads', label: 'Salads' },
  { value: 'desserts', label: 'Desserts' },
  { value: 'breads', label: 'Breads' },
  { value: 'mains', label: 'Main Dishes' },
  { value: 'drinks', label: 'Drinks' },
  { value: 'sides', label: 'Sides' },
];

export function AddMenuItemDialog({
  open,
  onOpenChange,
  onSubmit,
}: AddMenuItemDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [sku, setSku] = useState('');
  const [category, setCategory] = useState<MenuItemCategory>('mains');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit?.({ name, description, price, sku, category });
    // Reset
    setName('');
    setDescription('');
    setPrice('');
    setSku('');
    setCategory('mains');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[520px] rounded-3xl p-0 overflow-hidden border-0"
        style={{ background: 'var(--surface-container-lowest)' }}
      >
        {/* Header accent */}
        <div
          className="px-7 pt-7 pb-5"
          style={{
            background: 'linear-gradient(135deg, #0d631b 0%, #2e7d32 100%)',
          }}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
              <Leaf className="h-5 w-5 text-white" />
            </div>
            <div>
              <DialogTitle className="text-white font-headline font-bold text-lg leading-tight">
                Add New Menu Item
              </DialogTitle>
              <DialogDescription className="text-white/70 text-xs mt-0.5">
                Expand your digital garden with a new offering.
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-7 pt-5 pb-7 space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label
              htmlFor="item-name"
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--on-surface-variant)' }}
            >
              Item Name
            </Label>
            <div className="relative">
              <FileText
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
                style={{ color: 'var(--on-surface-variant)' }}
              />
              <Input
                id="item-name"
                placeholder="e.g. Heirloom Tomato & Basil Salad"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="pl-9 rounded-xl border-0 focus-visible:ring-primary/30"
                style={{ background: 'var(--surface-container-low)' }}
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label
              htmlFor="item-description"
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--on-surface-variant)' }}
            >
              Description
            </Label>
            <Textarea
              id="item-description"
              placeholder="Describe the dish, ingredients, or story..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="rounded-xl border-0 resize-none focus-visible:ring-primary/30"
              style={{ background: 'var(--surface-container-low)' }}
            />
          </div>

          {/* Price + SKU row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="item-price"
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'var(--on-surface-variant)' }}
              >
                Price
              </Label>
              <div className="relative">
                <DollarSign
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
                  style={{ color: 'var(--on-surface-variant)' }}
                />
                <Input
                  id="item-price"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  required
                  className="pl-9 rounded-xl border-0 focus-visible:ring-primary/30"
                  style={{ background: 'var(--surface-container-low)' }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="item-sku"
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'var(--on-surface-variant)' }}
              >
                SKU
              </Label>
              <div className="relative">
                <Tag
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
                  style={{ color: 'var(--on-surface-variant)' }}
                />
                <Input
                  id="item-sku"
                  placeholder="e.g. HTB-001"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  className="pl-9 rounded-xl border-0 focus-visible:ring-primary/30 font-mono"
                  style={{ background: 'var(--surface-container-low)' }}
                />
              </div>
            </div>
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <Label
              htmlFor="item-category"
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--on-surface-variant)' }}
            >
              Category
            </Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as MenuItemCategory)}
            >
              <SelectTrigger
                id="item-category"
                className="rounded-xl border-0 focus:ring-primary/30"
                style={{ background: 'var(--surface-container-low)' }}
              >
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              className="flex-1 rounded-full"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              id="submit-menu-item"
              type="submit"
              className="flex-1 rounded-full font-semibold"
              style={{
                background: 'linear-gradient(135deg, #0d631b 0%, #2e7d32 100%)',
                color: '#ffffff',
              }}
            >
              <Leaf className="mr-2 h-4 w-4" />
              Add to Menu
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
