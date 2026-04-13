import { useQuery } from '@tanstack/react-query';
import { restaurantApi } from '../api/restaurant.api';

export const restaurantKeys = {
  all: ['restaurants'] as const,
  one: (id: string) => ['restaurants', id] as const,
};

export function useRestaurants() {
  return useQuery({
    queryKey: restaurantKeys.all,
    queryFn: () => restaurantApi.getAll().then((r) => r.data),
  });
}

export function useRestaurant(id: string) {
  return useQuery({
    queryKey: restaurantKeys.one(id),
    queryFn: () => restaurantApi.getOne(id).then((r) => r.data),
    enabled: !!id,
  });
}
