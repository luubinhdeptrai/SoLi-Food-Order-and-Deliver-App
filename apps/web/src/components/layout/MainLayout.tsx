import { Fragment } from "react";
import { Link, Outlet, useMatches } from "react-router-dom";
import { AppSidebar } from "@/components/layout/AppSidebar";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

type BreadcrumbHandle = {
  breadcrumb?: string;
};

export function MainLayout() {
  const breadcrumbs = useMatches()
    .map((match) => {
      const handle = match.handle as BreadcrumbHandle | undefined;

      if (!handle?.breadcrumb) {
        return null;
      }

      return {
        href: match.pathname,
        label: handle.breadcrumb,
      };
    })
    .filter((breadcrumb): breadcrumb is { href: string; label: string } =>
      Boolean(breadcrumb),
    );

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="bg-background">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b px-4 bg-background">
          <SidebarTrigger className="-ml-1" />
          <div className="w-full flex-1 overflow-hidden">
            <Breadcrumb>
              <BreadcrumbList>
                {breadcrumbs.map((breadcrumb) => (
                  <Fragment key={breadcrumb.href}>
                    {breadcrumb.href !== breadcrumbs[0]?.href && (
                      <BreadcrumbSeparator />
                    )}
                    <BreadcrumbItem>
                      {breadcrumb.href ===
                      breadcrumbs[breadcrumbs.length - 1]?.href ? (
                        <BreadcrumbPage>{breadcrumb.label}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink asChild>
                          <Link to={breadcrumb.href}>{breadcrumb.label}</Link>
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 overflow-auto">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
