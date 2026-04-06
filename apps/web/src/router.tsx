import { createBrowserRouter } from "react-router-dom";
import { RootLayout } from "./routes/RootLayout";
import { HomePage } from "./routes/HomePage";
import { CartPage } from "./routes/CartPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "cart", element: <CartPage /> },
    ],
  },
]);
