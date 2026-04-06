import { useQuery } from "@tanstack/react-query";
import { fetchFeaturedMenu } from "../api/menu";
import { useCartStore } from "../store/cartStore";

export function HomePage() {
  const addItem = useCartStore((state) => state.addItem);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["featured-menu"],
    queryFn: fetchFeaturedMenu,
    staleTime: 60_000,
  });

  if (isLoading) {
    return <p className="text-slate-600">Loading featured menu...</p>;
  }

  if (isError || !data) {
    return <p className="text-red-600">Could not load menu right now.</p>;
  }

  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">Featured Menu</h1>
      <p className="text-slate-600">
        Built with React Router, TanStack Query, Tailwind CSS, and Zustand.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((item) => (
          <article
            key={item.id}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <h2 className="font-semibold">{item.name}</h2>
            <p className="mt-1 text-sm text-slate-600">
              ${item.price.toFixed(2)}
            </p>
            <button
              className="mt-3 rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-amber-600"
              onClick={addItem}
              type="button"
            >
              Add to cart
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
