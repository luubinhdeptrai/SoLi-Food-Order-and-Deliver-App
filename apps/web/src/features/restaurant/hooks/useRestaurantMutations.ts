import { useMutation, useQueryClient } from '@tanstack/react-query';
import { restaurantApi } from '../api/restaurant.api';
import { restaurantKeys } from './useRestaurants';
import type { UpdateRestaurantFormValues } from '../schemas/restaurant.schema';

export function useRestaurantMutations() {
  const qc = useQueryClient();

  const invalidateAll = () =>
    qc.invalidateQueries({ queryKey: restaurantKeys.all });

  const create = useMutation({
    mutationFn: restaurantApi.create,
    onSuccess: invalidateAll,
  });

  const update = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: UpdateRestaurantFormValues;
    }) => restaurantApi.update(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: restaurantKeys.one(id) });
      invalidateAll();
    },
  });

  const remove = useMutation({
    mutationFn: restaurantApi.remove,
    onSuccess: invalidateAll,
  });

  return { create, update, remove };
}
