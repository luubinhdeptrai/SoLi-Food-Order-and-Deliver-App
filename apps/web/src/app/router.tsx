import { createBrowserRouter } from "react-router-dom";
import { RegisterPage } from "@/app/pages/auth/register/RegisterPage";
import { RegisterLocationPage } from "@/app/pages/auth/register/RegisterBusinessPage";
import { RegisterPendingPage } from "@/app/pages/auth/register/RegisterPendingPage";
import { LoginPage } from "@/app/pages/auth/login/LoginPage";
import { MenuManagementPage } from "@/app/pages/menu/MenuManagementPage";

export const router = createBrowserRouter([
  {
    path: "/auth/register",
    element: <RegisterPage />,
  },
  {
    path: "/auth/register/business",
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
  {
    path: "/menu",
    element: <MenuManagementPage />,
  },
]);
