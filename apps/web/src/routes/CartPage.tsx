import { useCartStore } from "../store/cartStore";

export function CartPage() {
  const itemCount = useCartStore((state) => state.itemCount);
  const clear = useCartStore((state) => state.clear);

  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">Your Cart</h1>
      <p className="text-slate-600">
        You currently have{" "}
        <span className="font-semibold text-slate-900">{itemCount}</span>{" "}
        item(s) in your cart.
      </p>
      <button
        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        onClick={clear}
        type="button"
      >
        Clear cart
      </button>
    </section>
  );
}
