export interface Restaurant {
  id: string;
  ownerId: string;
  name: string;
  address: string;
  phone: string;
  description: string | null;
  isOpen: boolean;
  isApproved: boolean;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
  updatedAt: string;
}
