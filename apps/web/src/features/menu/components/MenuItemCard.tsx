import { useState } from 'react';
import { MenuItem } from '@/features/menu/types';
import { Edit2, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface MenuItemCardProps {
  item: MenuItem;
  onEdit?: (item: MenuItem) => void;
  onDelete?: (id: string) => void;
}

export function MenuItemCard({ item, onEdit, onDelete }: MenuItemCardProps) {
  const [isAvailable, setIsAvailable] = useState(item.isAvailable);

  const isSoldOut = item.status === 'out_of_stock' || !isAvailable;

  return (
    <Card
      className={`bg-surface-container-lowest rounded-3xl py-0 gap-0 ring-0 group transition-all duration-300 ${
        isSoldOut ? 'bg-opacity-60' : 'hover:shadow-xl hover:shadow-primary/5'
      }`}
    >
      <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-6">
        {/* Image Block */}
        <div
          className={`relative h-24 w-24 md:h-32 md:w-32 rounded-2xl overflow-hidden flex-shrink-0 ${
            isSoldOut ? 'grayscale' : ''
          }`}
        >
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="h-full w-full bg-surface-container flex items-center justify-center text-on-surface-variant font-medium text-xs">
              No Image
            </div>
          )}
          {isSoldOut ? (
            <div className="absolute inset-0 bg-on-surface/40 flex items-center justify-center">
              <span className="text-white text-[10px] font-bold uppercase tracking-widest bg-error px-2 py-1 rounded">
                Sold Out
              </span>
            </div>
          ) : item.tags && item.tags.length > 0 ? (
            <div className="absolute top-2 left-2 bg-primary text-on-primary text-[10px] font-bold px-2 py-0.5 rounded-full">
              {item.tags[0].toUpperCase()}
            </div>
          ) : null}
        </div>

        {/* Content Block */}
        <div className={`flex-1 ${isSoldOut ? 'opacity-60' : ''}`}>
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-headline text-xl font-bold text-on-surface">
                {item.name}
              </h3>
              <p className="text-sm text-on-surface-variant mt-1">
                {item.description}
              </p>
            </div>
            <div className="text-right">
              <p className="font-headline text-lg font-extrabold text-secondary">
                ${item.price.toFixed(2)}
              </p>
              <p className="text-[10px] text-outline font-bold uppercase tracking-tighter mt-1">
                SKU: {item.sku}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 bg-surface-container px-3 py-1.5 rounded-full">
              <span className="text-xs font-bold text-on-surface-variant">
                Live Status:
              </span>
              <div
                className={`h-2 w-2 rounded-full ${
                  isSoldOut ? 'bg-error' : 'bg-primary'
                }`}
              />
              <span
                className={`text-xs font-bold uppercase ${
                  isSoldOut ? 'text-error' : 'text-primary'
                }`}
              >
                {isSoldOut ? 'Unavailable' : 'Available'}
              </span>
            </div>

            {!isSoldOut && (
              <div className="flex gap-2">
                <button
                  onClick={() => onEdit?.(item)}
                  className="p-2 bg-surface-container-high rounded-xl text-on-surface hover:bg-primary-fixed transition-colors"
                >
                  <Edit2 className="w-5 h-5" />
                </button>
                <button
                  onClick={() => onDelete?.(item.id)}
                  className="p-2 bg-surface-container-high rounded-xl text-error hover:bg-error-container transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Toggle Block */}
        <div className="md:border-l md:border-outline-variant/20 md:pl-6 flex md:flex-col justify-between md:justify-center gap-4">
          <label className="inline-flex items-center cursor-pointer">
            <span className="mr-3 text-xs font-bold text-outline uppercase tracking-wider">
              Availability
            </span>
            <div className="relative">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={isAvailable}
                onChange={(e) => setIsAvailable(e.target.checked)}
              />
              <div className="w-11 h-6 bg-surface-container-highest rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </div>
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
