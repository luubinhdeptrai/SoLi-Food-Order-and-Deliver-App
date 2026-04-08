import { createBrowserRouter } from "react-router-dom";
import { RegisterPage } from "@/app/pages/auth/register/RegisterPage";
import { RegisterLocationPage } from "@/app/pages/auth/register/RegisterBusinessPage";
import { RegisterPendingPage } from "@/app/pages/auth/register/RegisterPendingPage";
import { LoginPage } from "@/app/pages/auth/login/LoginPage";

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
  {
    path: "/auth/login",
    element: <LoginPage />,
  },
]);
