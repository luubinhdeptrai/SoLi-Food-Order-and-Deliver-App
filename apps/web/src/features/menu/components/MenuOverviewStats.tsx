import { BarChart3, CheckCircle2, XCircle, Tag } from 'lucide-react';
import type { MenuOverview } from '@/features/menu/types';

interface MenuOverviewStatsProps {
  overview: MenuOverview;
}

const statConfig = [
  {
    key: 'totalItems' as const,
    label: 'Total Items',
    icon: BarChart3,
    color: '#0d631b',
    bg: '#f0fdf4',
  },
  {
    key: 'availableItems' as const,
    label: 'Available',
    icon: CheckCircle2,
    color: '#059669',
    bg: '#ecfdf5',
  },
  {
    key: 'outOfStockItems' as const,
    label: 'Out of Stock',
    icon: XCircle,
    color: '#dc2626',
    bg: '#fef2f2',
  },
];

export function MenuOverviewStats({ overview }: MenuOverviewStatsProps) {
  return (
    <div
      className="rounded-2xl p-5 space-y-4"
      style={{ background: 'var(--surface-container-lowest)' }}
    >
      <div className="flex items-center gap-2">
        <BarChart3
          className="h-4 w-4"
          style={{ color: 'var(--on-surface-variant)' }}
        />
        <h2
          className="text-sm font-semibold font-headline"
          style={{ color: 'var(--on-surface)' }}
        >
          Menu Overview
        </h2>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3">
        {statConfig.map(({ key, label, icon: Icon, color, bg }) => (
          <div
            key={key}
            className="rounded-xl p-3 text-center space-y-1"
            style={{ background: bg }}
          >
            <Icon className="h-5 w-5 mx-auto" style={{ color }} />
            <p className="text-xl font-bold font-headline" style={{ color }}>
              {overview[key]}
            </p>
            <p className="text-[10px] font-medium" style={{ color }}>
              {label}
            </p>
          </div>
        ))}
      </div>

      {/* Categories */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Tag
            className="h-3.5 w-3.5"
            style={{ color: 'var(--on-surface-variant)' }}
          />
          <p
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--on-surface-variant)' }}
          >
            Categories
          </p>
        </div>
        <div className="space-y-2">
          {overview.categories.map((cat) => (
            <div key={cat.id} className="flex items-center justify-between">
              <span
                className="text-xs capitalize"
                style={{ color: 'var(--on-surface)' }}
              >
                {cat.label}
              </span>
              <div className="flex items-center gap-2">
                {/* mini bar */}
                <div
                  className="h-1.5 rounded-full overflow-hidden"
                  style={{
                    width: '60px',
                    background: 'var(--surface-container-high)',
                  }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(cat.count / overview.totalItems) * 100}%`,
                      background: 'linear-gradient(90deg, #0d631b, #2e7d32)',
                    }}
                  />
                </div>
                <span
                  className="text-[10px] font-semibold w-4 text-right"
                  style={{ color: 'var(--on-surface-variant)' }}
                >
                  {cat.count}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
