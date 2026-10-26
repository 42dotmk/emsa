import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  FolderOpen,
  History,
  House,
  LayoutDashboard,
  Mountain,
  Users,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { NavUser } from "@/components/admin/NavUser";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Role } from "@/constants/enums";
import { queryKeys } from "@/constants/query-keys";
import { ApiRoutes, PageRoutes } from "@/constants/routes";
import { type OrganizationPublic } from "@/constants/types";
import { useAuth } from "@/context/auth";
import { usePillarLabels } from "@/hooks/usePillarLabels";
import { apiClient } from "@/lib/api-client";
import { cn, hasAccess } from "@/lib/utils";

const navItems = [
  {
    title: "Dashboard",
    url: PageRoutes.ADMIN_DASHBOARD,
    icon: LayoutDashboard,
    requiredRole: Role.ADMIN,
  },
  {
    title: "Organization",
    url: PageRoutes.ADMIN_ORGANIZATION,
    icon: Building2,
    requiredRole: Role.SUPER_ADMIN,
  },
  {
    title: "Users",
    url: PageRoutes.ADMIN_USERS,
    icon: Users,
    requiredRole: Role.ADMIN,
  },
  {
    title: "Projects",
    url: PageRoutes.ADMIN_PROJECTS,
    icon: FolderOpen,
    requiredRole: Role.ADMIN,
  },
  {
    title: "Pillars",
    url: PageRoutes.ADMIN_PILLARS,
    icon: Mountain,
    requiredRole: Role.SUPER_ADMIN,
  },
  {
    title: "Audit log",
    url: PageRoutes.ADMIN_AUDIT_LOG,
    icon: History,
    requiredRole: Role.SUPER_ADMIN,
  },
];

function NavItems() {
  const { user } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();
  const { plural } = usePillarLabels();

  return (
    <SidebarMenu>
      {navItems
        .filter((item) => user && hasAccess(user.role, item.requiredRole))
        .map((item) => {
          const title = item.url === PageRoutes.ADMIN_PILLARS ? plural : item.title;
          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild tooltip={title}>
                <NavLink
                  to={item.url}
                  className={({ isActive }) => (isActive ? "font-medium" : "")}
                  onClick={() => isMobile && setOpenMobile(false)}
                >
                  <item.icon />
                  <span>{title}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
    </SidebarMenu>
  );
}

function BackToSiteItem() {
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton asChild tooltip="Back to Site">
          <NavLink to={PageRoutes.HOME} onClick={() => isMobile && setOpenMobile(false)}>
            <House />
            <span>Back to Site</span>
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AdminLayout() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const { plural } = usePillarLabels();
  const { data: org } = useQuery({
    queryKey: queryKeys.organization(),
    queryFn: () => apiClient.get<OrganizationPublic>(ApiRoutes.ORGANIZATION),
    staleTime: Infinity,
  });

  const pageTitle =
    pathname === PageRoutes.ADMIN_PILLARS
      ? plural
      : (navItems.find((item) => item.url === pathname)?.title ?? "Admin");

  return (
    <SidebarProvider className="min-h-screen w-full">
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <NavLink to={PageRoutes.ADMIN_DASHBOARD}>
                  <div
                    className={cn(
                      "flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg text-sidebar-primary-foreground",
                      !org?.logoUrl && "bg-sidebar-primary"
                    )}
                  >
                    {org?.logoUrl ? (
                      <img src={org.logoUrl} alt="Logo" className="size-full object-cover" />
                    ) : (
                      <LayoutDashboard className="size-4" />
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 leading-none">
                    <span className="font-semibold">Admin Panel</span>
                    <span className="text-xs text-muted-foreground">Management</span>
                  </div>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <NavItems />
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <BackToSiteItem />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>{user && <NavUser user={user} onLogout={logout} />}</SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-h-screen min-w-0">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <span className="text-sm font-medium">{pageTitle}</span>
        </header>
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
