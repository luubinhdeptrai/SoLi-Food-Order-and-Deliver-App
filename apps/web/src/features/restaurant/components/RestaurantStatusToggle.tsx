import { Button } from '@/components/ui/button';
import { useRestaurantMutations } from '../hooks/useRestaurantMutations';

interface Props {
  restaurantId: string;
  isOpen: boolean;
  onToggle?: () => void;
}

export function RestaurantStatusToggle({
  restaurantId,
  isOpen,
  onToggle,
}: Props) {
  const { update } = useRestaurantMutations();

  const handleToggle = () => {
    update.mutate(
      {
        id: restaurantId,
        data: { isOpen: !isOpen },
      },
      {
        onSuccess: () => {
          onToggle?.();
        },
      },
    );
  };

  return (
    <Button
      variant={isOpen ? 'default' : 'outline'}
      onClick={handleToggle}
      disabled={update.isPending}
    >
      {isOpen ? 'Open' : 'Closed'}
    </Button>
  );
}
