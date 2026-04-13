import { Button } from '@/components/ui/button';
import type { Restaurant } from '../api/restaurant.types';

interface Props {
  restaurants: Restaurant[];
  onEdit: (restaurant: Restaurant) => void;
  onDelete: (id: string) => void;
  isDeleting?: boolean;
}

export function RestaurantTable({
  restaurants,
  onEdit,
  onDelete,
  isDeleting,
}: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse border border-gray-200">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-200 px-4 py-2 text-left">Name</th>
            <th className="border border-gray-200 px-4 py-2 text-left">Address</th>
            <th className="border border-gray-200 px-4 py-2 text-left">Phone</th>
            <th className="border border-gray-200 px-4 py-2 text-left">Status</th>
            <th className="border border-gray-200 px-4 py-2 text-left">Approved</th>
            <th className="border border-gray-200 px-4 py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {restaurants.map((r) => (
            <tr key={r.id}>
              <td className="border border-gray-200 px-4 py-2">{r.name}</td>
              <td className="border border-gray-200 px-4 py-2">{r.address}</td>
              <td className="border border-gray-200 px-4 py-2">{r.phone}</td>
              <td className="border border-gray-200 px-4 py-2">
                {r.isOpen ? 'Open' : 'Closed'}
              </td>
              <td className="border border-gray-200 px-4 py-2">
                {r.isApproved ? 'Yes' : 'Pending'}
              </td>
              <td className="border border-gray-200 px-4 py-2">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onEdit(r)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => onDelete(r.id)}
                    disabled={isDeleting}
                  >
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
