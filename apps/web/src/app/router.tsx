import { createBrowserRouter } from "react-router-dom";
import { RegisterPage } from "./pages/auth/RegisterPage";
import { RegisterLocationPage } from "./pages/auth/RegisterLocationPage";
import { RegisterPendingPage } from "./pages/auth/RegisterPendingPage";

export const router = createBrowserRouter([
  {
    path: "/auth/register",
    element: <RegisterPage />,
  },
  {
    path: "/auth/register/location",
    element: <RegisterLocationPage />,
  },
  {
    path: "/auth/register/pending",
    element: <RegisterPendingPage />,
  },
]);
