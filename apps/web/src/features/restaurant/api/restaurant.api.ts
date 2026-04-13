import { apiClient } from '@/lib/api-client';
import type { Restaurant } from './restaurant.types';
import type { RestaurantFormValues, UpdateRestaurantFormValues } from '../schemas/restaurant.schema';

export const restaurantApi = {
  getAll: () => apiClient.get<Restaurant[]>('/restaurants'),
  getOne: (id: string) => apiClient.get<Restaurant>(`/restaurants/${id}`),
  create: (data: RestaurantFormValues) =>
    apiClient.post<Restaurant>('/restaurants', data),
  update: (id: string, data: UpdateRestaurantFormValues) =>
    apiClient.patch<Restaurant>(`/restaurants/${id}`, data),
  remove: (id: string) => apiClient.delete(`/restaurants/${id}`),
};
