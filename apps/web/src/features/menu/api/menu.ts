export type MenuItem = {
  id: number;
  name: string;
  price: number;
};

const fallbackMenu: MenuItem[] = [
  { id: 1, name: "Crispy Chicken Burger", price: 7.5 },
  { id: 2, name: "Spicy Tuna Roll", price: 9.0 },
  { id: 3, name: "Truffle Fries", price: 5.25 },
];

export async function fetchFeaturedMenu(): Promise<MenuItem[]> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  return fallbackMenu;
}
