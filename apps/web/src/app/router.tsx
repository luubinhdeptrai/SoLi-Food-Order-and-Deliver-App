import { createBrowserRouter } from "react-router-dom";
import { CartPage } from "./routes/CartPage";
import { HomePage } from "./routes/HomePage";
import { RootLayout } from "./routes/RootLayout";

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