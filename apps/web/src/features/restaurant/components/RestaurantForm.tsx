import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  restaurantSchema,
  type RestaurantFormValues,
} from '../schemas/restaurant.schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  defaultValues?: Partial<RestaurantFormValues>;
  onSubmit: (values: RestaurantFormValues) => void;
  isLoading?: boolean;
  submitLabel?: string;
}

export function RestaurantForm({
  defaultValues,
  onSubmit,
  isLoading,
  submitLabel = 'Save',
}: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RestaurantFormValues>({
    resolver: zodResolver(restaurantSchema),
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" placeholder="Restaurant name" {...register('name')} />
        {errors.name && (
          <span className="text-sm text-red-500">{errors.name.message}</span>
        )}
      </div>

      <div>
        <Label htmlFor="address">Address</Label>
        <Input
          id="address"
          placeholder="Full address"
          {...register('address')}
        />
        {errors.address && (
          <span className="text-sm text-red-500">{errors.address.message}</span>
        )}
      </div>

      <div>
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" placeholder="Phone number" {...register('phone')} />
        {errors.phone && (
          <span className="text-sm text-red-500">{errors.phone.message}</span>
        )}
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          placeholder="Restaurant description"
          {...register('description')}
        />
        {errors.description && (
          <span className="text-sm text-red-500">
            {errors.description.message}
          </span>
        )}
      </div>

      <Button type="submit" disabled={isLoading}>
        {isLoading ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}
