import { Link, NavLink, Outlet } from "react-router-dom";
import { useCartStore } from "../../features/cart/stores/cartStore";

export function RootLayout() {
  const itemCount = useCartStore((state) => state.itemCount);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-amber-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link to="/" className="text-lg font-semibold">
            FoodieDash Web
          </Link>
          <nav className="flex items-center gap-5 text-sm font-medium">
            <NavLink
              to="/"
              className={({ isActive }) =>
                isActive
                  ? "text-amber-600"
                  : "text-slate-600 hover:text-slate-900"
              }
            >
              Home
            </NavLink>
            <NavLink
              to="/cart"
              className={({ isActive }) =>
                isActive
                  ? "text-amber-600"
                  : "text-slate-600 hover:text-slate-900"
              }
            >
              Cart ({itemCount})
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}