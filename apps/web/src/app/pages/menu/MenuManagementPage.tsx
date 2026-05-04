import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MenuItemCard } from '@/features/menu/components/MenuItemCard';
import { MenuSidebar } from '@/features/menu/components/MenuSidebar';
import { mockMenuItems, mockMenuOverview } from '@/features/menu/api/menu';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

// Filter tabs dummy data
const filterTabs = ['Farm Fresh', 'Artisan Bakery', 'Dairy & Cheese', 'Pantry'];

export function MenuManagementPage() {
  const navigate = useNavigate();
  const [storeOnline, setStoreOnline] = useState(true);

  const handleAddItem = () => {
    navigate('/menu/create');
  };

  return (
    <>
      <main className="flex-1 p-6 md:p-10 bg-surface min-h-screen">
        {/* Restaurant Status Header */}
        <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="font-headline text-4xl font-extrabold text-on-surface tracking-tight">
              Menu Management
            </h1>
            <p className="text-on-surface-variant mt-2 text-lg">
              Curate your seasonal offerings and manage live availability.
            </p>
          </div>

          {/* Quick Status Control Card */}
          <Card className="bg-surface-container-lowest rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-outline-variant/10 ring-0 py-0 gap-0">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-green-100 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-3xl font-variation-settings-['FILL'_1]">
                  storefront
                </span>
              </div>
              <div className="pr-4">
                <p className="text-xs font-bold uppercase tracking-widest text-outline">
                  Store Visibility
                </p>
                <p className="text-sm font-bold text-primary">
                  {storeOnline ? 'Currently Accepting Orders' : 'Store Offline'}
                </p>
              </div>
              <Button
                onClick={() => setStoreOnline(!storeOnline)}
                className="bg-primary px-6 py-2.5 rounded-full text-white font-bold text-sm shadow-md hover:opacity-90 transition-opacity"
              >
                {storeOnline ? 'Go Offline' : 'Go Online'}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Dashboard Bento Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-12">
          {/* Main Menu Control */}
          <div className="lg:col-span-8 space-y-6">
            {/* Categories Horizontal Scroll */}
            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
              <Button
                type="button"
                variant="ghost"
                className="h-auto flex-shrink-0 px-6 py-3 bg-primary-fixed text-on-primary-fixed rounded-full font-bold flex items-center gap-2 hover:bg-primary-fixed"
              >
                <span className="material-symbols-outlined text-sm font-variation-settings-['FILL'_1]">
                  grid_view
                </span>{' '}
                All Items
              </Button>

              {filterTabs.map((tab) => (
                <Button
                  type="button"
                  key={tab}
                  variant="ghost"
                  className="h-auto flex-shrink-0 px-6 py-3 bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container rounded-full font-semibold transition-colors"
                >
                  {tab}
                </Button>
              ))}

              <Button
                type="button"
                onClick={handleAddItem}
                variant="ghost"
                className="h-auto flex-shrink-0 p-3 bg-surface-container-lowest text-primary rounded-full hover:bg-surface-container transition-colors"
              >
                <span className="material-symbols-outlined">add</span>
              </Button>
            </div>

            {/* Items List */}
            <div className="space-y-4">
              {mockMenuItems.map((item) => (
                <MenuItemCard
                  key={item.id}
                  item={item}
                  onEdit={(item) => console.log('edit', item)}
                  onDelete={(id) => console.log('delete', id)}
                />
              ))}
            </div>
          </div>

          {/* Right Rail Stats & Quick Actions */}
          <div className="lg:col-span-4 space-y-6">
            <MenuSidebar
              overview={mockMenuOverview}
              onAddItem={handleAddItem}
            />
          </div>
        </div>
      </main>
    </>
  );
}
