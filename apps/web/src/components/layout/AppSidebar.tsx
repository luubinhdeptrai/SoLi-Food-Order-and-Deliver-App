import { Link, useLocation } from "react-router-dom";
import {
  UtensilsCrossed,
  LayoutGrid,
  ClipboardList,
  Utensils,
  CircleHelp,
  LogOut,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

const mainNavItems = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: LayoutGrid,
  },
  {
    title: "Orders",
    url: "/orders",
    icon: ClipboardList,
  },
  {
    title: "Menu",
    url: "/menu",
    icon: Utensils,
  },
];

const footerNavItems = [
  {
    title: "Help",
    url: "/help",
    icon: CircleHelp,
  },
  {
    title: "Logout",
    url: "/logout",
    icon: LogOut,
    className: "text-error",
  },
];

export function AppSidebar() {
  const location = useLocation();

  return (
    <Sidebar className="bg-card">
      <SidebarHeader className="p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-200">
            <UtensilsCrossed className="h-6 w-6 text-primary" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold leading-tight text-primary">
              Harvest Kitchen
            </span>
            <span className="text-[10px] font-bold tracking-wider text-muted-foreground">
              MANAGEMENT PORTAL
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-4">
        <SidebarMenu className="gap-1">
          {mainNavItems.map((item) => {
            const isActive = location.pathname.startsWith(item.url);
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  className={isActive ? "bg-primary-200 text-primary hover:bg-primary-200 hover:text-primary" : "text-on-surface-variant"}
                >
                  <Link to={item.url} className="flex items-center gap-3 py-6">
                    <item.icon className={isActive ? "text-primary" : "text-on-surface-variant"} />
                    <span className="font-medium">{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="p-4 gap-4">
        <div className="px-2">
          <Button
            className="w-full bg-primary hover:bg-primary-600 text-primary-foreground rounded-2xl py-6 font-bold editorial-gradient"
          >
            New Order
          </Button>
        </div>
        
        <SidebarMenu className="gap-1">
          {footerNavItems.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                className="text-on-surface-variant hover:bg-surface-container"
              >
                <Link to={item.url} className="flex items-center gap-3">
                  <item.icon className={item.className || "text-on-surface-variant"} />
                  <span className={item.className || "font-medium"}>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
