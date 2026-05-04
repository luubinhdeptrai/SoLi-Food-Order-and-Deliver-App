import { create } from 'zustand';

type CartState = {
  itemCount: number;
  addItem: () => void;
  clear: () => void;
};

export const useCartStore = create<CartState>((set) => ({
  itemCount: 0,
  addItem: () => set((state) => ({ itemCount: state.itemCount + 1 })),
  clear: () => set({ itemCount: 0 }),
}));
