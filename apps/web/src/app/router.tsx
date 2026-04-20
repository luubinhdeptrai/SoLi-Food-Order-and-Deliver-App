import { createBrowserRouter } from "react-router-dom";
import { RegisterPage } from "@/app/pages/auth/register/RegisterPage";
import { RegisterLocationPage } from "@/app/pages/auth/register/RegisterBusinessPage";
import { RegisterPendingPage } from "@/app/pages/auth/register/RegisterPendingPage";
import { LoginPage } from "@/app/pages/auth/login/LoginPage";
import { MenuManagementPage } from "@/app/pages/menu/MenuManagementPage";
import CreateMenuItemPage from "@/app/pages/menu/CreateMenuItemPage";
import { OrdersPage } from "@/app/pages/orders/OrdersPage";
import { OrderDetailPage } from "@/app/pages/orders/OrderDetailPage";
import { MainLayout } from "@/components/layout/MainLayout";

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
    path: "/",
    element: <MainLayout />,
    handle: {
      breadcrumb: "Home",
    },
    children: [
      {
        path: "orders",
        handle: {
          breadcrumb: "Orders",
        },
        children: [
          {
            index: true,
            element: <OrdersPage />,
          },
          {
            path: ":orderId",
            element: <OrderDetailPage />,
            handle: {
              breadcrumb: "Order Detail",
            },
          },
        ],
      },
      {
        path: "menu",
        handle: {
          breadcrumb: "Menu",
        },
        children: [
          {
            index: true,
            element: <MenuManagementPage />,
          },
          {
            path: "create",
            element: <CreateMenuItemPage />,
            handle: {
              breadcrumb: "Create Item",
            },
          },
        ],
      },
    ],
  },
]);
