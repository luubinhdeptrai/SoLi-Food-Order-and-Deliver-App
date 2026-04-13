import { z } from 'zod';

export const restaurantSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  address: z.string().min(5, 'Please enter a full address'),
  phone: z.string().min(8, 'Enter a valid phone number'),
  description: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export const updateRestaurantSchema = restaurantSchema.partial().extend({
  isOpen: z.boolean().optional(),
});

export type RestaurantFormValues = z.infer<typeof restaurantSchema>;
export type UpdateRestaurantFormValues = z.infer<typeof updateRestaurantSchema>;
