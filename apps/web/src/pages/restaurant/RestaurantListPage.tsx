import { useState } from 'react';
import {
  RestaurantForm,
  RestaurantTable,
  useRestaurants,
  useRestaurantMutations,
  type Restaurant,
  type RestaurantFormValues,
} from '@/features/restaurant';
import { Button } from '@/components/ui/button';

export function RestaurantListPage() {
  const { data = [], isLoading } = useRestaurants();
  const { create, update, remove } = useRestaurantMutations();
  const [editing, setEditing] = useState<Restaurant | null>(null);

  function handleEdit(r: Restaurant) {
    setEditing(r);
  }

  function handleCancel() {
    setEditing(null);
  }

  function handleCreateSubmit(values: RestaurantFormValues) {
    create.mutate(values);
  }

  function handleUpdateSubmit(values: RestaurantFormValues) {
    if (!editing) return;
    update.mutate(
      {
        id: editing.id,
        data: values,
      },
      {
        onSuccess: handleCancel,
      },
    );
  }

  function handleDelete(id: string) {
    remove.mutate(id);
  }

  return (
    <div className="space-y-8 p-6">
      <div>
        <h1 className="mb-6 text-3xl font-bold">Restaurants</h1>

        {editing ? (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Edit — {editing.name}</h2>
            <RestaurantForm
              defaultValues={editing}
              onSubmit={handleUpdateSubmit}
              isLoading={update.isPending}
              submitLabel="Update restaurant"
            />
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Add restaurant</h2>
            <RestaurantForm
              onSubmit={handleCreateSubmit}
              isLoading={create.isPending}
              submitLabel="Create restaurant"
            />
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-4 text-2xl font-semibold">Restaurants List</h2>
        {isLoading ? (
          <p>Loading…</p>
        ) : (
          <RestaurantTable
            restaurants={data}
            onEdit={handleEdit}
            onDelete={handleDelete}
            isDeleting={remove.isPending}
          />
        )}
      </div>
    </div>
  );
}
