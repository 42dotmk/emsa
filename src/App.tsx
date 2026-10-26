import "@/index.css";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { MotionConfig } from "motion/react";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ProfileGuard } from "@/components/ProfileGuard";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ScrollToTop } from "@/components/ScrollToTop";
import { Role } from "@/constants/enums";
import { queryKeys } from "@/constants/query-keys";
import { ApiRoutes, PageRoutes } from "@/constants/routes";
import { type OrganizationPublic } from "@/constants/types";
import { AuthProvider } from "@/context/auth";
import { apiClient } from "@/lib/api-client";

function OrganizationMeta() {
  const { data: org } = useQuery({
    queryKey: queryKeys.organization(),
    queryFn: () => apiClient.get<OrganizationPublic>(ApiRoutes.ORGANIZATION),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!org) return;
    if (org.name) document.title = org.name;
    if (org.logoUrl) {
      let favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (!favicon) {
        favicon = document.createElement("link");
        favicon.rel = "icon";
        document.head.appendChild(favicon);
      }
      favicon.href = org.logoUrl;
    }
  }, [org]);

  return null;
}

const STALE_TIME_5_MINUTES = 1000 * 60 * 5;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_TIME_5_MINUTES,
      retry: 1,
    },
  },
});

// Public
const PublicLayout = lazy(() =>
  import("@/components/PublicLayout").then((m) => ({ default: m.PublicLayout }))
);
const HomePage = lazy(() => import("@/pages/HomePage").then((m) => ({ default: m.HomePage })));
const ProjectsPage = lazy(() =>
  import("@/pages/ProjectsPage").then((m) => ({ default: m.ProjectsPage }))
);
const ProjectDetailPage = lazy(() =>
  import("@/pages/ProjectDetailPage").then((m) => ({ default: m.ProjectDetailPage }))
);
const PillarDetailPage = lazy(() =>
  import("@/pages/PillarDetailPage").then((m) => ({ default: m.PillarDetailPage }))
);
const GalleryPage = lazy(() =>
  import("@/pages/GalleryPage").then((m) => ({ default: m.GalleryPage }))
);

// Auth / misc
const LoginPage = lazy(() => import("@/pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() =>
  import("@/pages/RegisterPage").then((m) => ({ default: m.RegisterPage }))
);
const AuthCallbackPage = lazy(() =>
  import("@/pages/AuthCallbackPage").then((m) => ({ default: m.AuthCallbackPage }))
);
const UnauthorizedPage = lazy(() =>
  import("@/pages/UnauthorizedPage").then((m) => ({ default: m.UnauthorizedPage }))
);
const ForgotPasswordPage = lazy(() =>
  import("@/pages/ForgotPasswordPage").then((m) => ({ default: m.ForgotPasswordPage }))
);
const ResetPasswordPage = lazy(() =>
  import("@/pages/ResetPasswordPage").then((m) => ({ default: m.ResetPasswordPage }))
);
const SetupPasswordPage = lazy(() =>
  import("@/pages/SetupPasswordPage").then((m) => ({ default: m.SetupPasswordPage }))
);
const ProfilePage = lazy(() =>
  import("@/pages/ProfilePage").then((m) => ({ default: m.ProfilePage }))
);

// Admin
const AdminLayout = lazy(() =>
  import("@/components/admin/AdminLayout").then((m) => ({ default: m.AdminLayout }))
);
const DashboardPage = lazy(() =>
  import("@/pages/admin/DashboardPage").then((m) => ({ default: m.DashboardPage }))
);
const AdminUsersPage = lazy(() =>
  import("@/pages/admin/UsersPage").then((m) => ({ default: m.UsersPage }))
);
const AdminPillarsPage = lazy(() =>
  import("@/pages/admin/PillarsPage").then((m) => ({ default: m.PillarsPage }))
);
const AdminProjectsPage = lazy(() =>
  import("@/pages/admin/ProjectsPage").then((m) => ({ default: m.ProjectsPage }))
);
const AdminProjectDetailPage = lazy(() =>
  import("@/pages/admin/ProjectDetailPage").then((m) => ({ default: m.AdminProjectDetailPage }))
);
const OrganizationPage = lazy(() =>
  import("@/pages/admin/OrganizationPage").then((m) => ({ default: m.OrganizationPage }))
);
const AuditLogPage = lazy(() =>
  import("@/pages/admin/AuditLogPage").then((m) => ({ default: m.AuditLogPage }))
);

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <OrganizationMeta />
        <AuthProvider>
          <MotionConfig reducedMotion="user">
            <BrowserRouter>
              <ScrollToTop />
              <ProfileGuard>
                <Suspense
                  fallback={
                    <div className="flex min-h-screen items-center justify-center">
                      <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    </div>
                  }
                >
                  <Routes>
                    {/* Public site */}
                    <Route element={<PublicLayout />}>
                      <Route path={PageRoutes.HOME} element={<HomePage />} />
                      <Route path={PageRoutes.PROJECTS} element={<ProjectsPage />} />
                      <Route path={PageRoutes.PROJECT_DETAIL} element={<ProjectDetailPage />} />
                      <Route path={PageRoutes.PILLAR_DETAIL} element={<PillarDetailPage />} />
                      <Route path={PageRoutes.GALLERY} element={<GalleryPage />} />
                      <Route
                        path={PageRoutes.PROFILE}
                        element={
                          <ProtectedRoute requiredRole={Role.USER}>
                            <ProfilePage />
                          </ProtectedRoute>
                        }
                      />
                    </Route>

                    {/* Auth */}
                    <Route path={PageRoutes.LOGIN} element={<LoginPage />} />
                    <Route path={PageRoutes.REGISTER} element={<RegisterPage />} />
                    <Route path={PageRoutes.FORGOT_PASSWORD} element={<ForgotPasswordPage />} />
                    <Route path={PageRoutes.RESET_PASSWORD} element={<ResetPasswordPage />} />
                    <Route path={PageRoutes.SETUP_PASSWORD} element={<SetupPasswordPage />} />
                    <Route path={PageRoutes.UNAUTHORIZED} element={<UnauthorizedPage />} />
                    <Route path={PageRoutes.AUTH_CALLBACK} element={<AuthCallbackPage />} />
                    <Route path="*" element={<Navigate to={PageRoutes.HOME} replace />} />

                    {/* Admin */}
                    <Route
                      path={PageRoutes.ADMIN}
                      element={
                        <ProtectedRoute requiredRole={Role.ADMIN}>
                          <AdminLayout />
                        </ProtectedRoute>
                      }
                    >
                      <Route index element={<Navigate to={PageRoutes.ADMIN_DASHBOARD} replace />} />
                      <Route
                        path={PageRoutes.ADMIN_DASHBOARD_SEGMENT}
                        element={<DashboardPage />}
                      />
                      <Route
                        path={PageRoutes.ADMIN_USERS_SEGMENT}
                        element={
                          <ProtectedRoute requiredRole={Role.ADMIN}>
                            <AdminUsersPage />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path={PageRoutes.ADMIN_PILLARS_SEGMENT}
                        element={
                          <ProtectedRoute requiredRole={Role.SUPER_ADMIN}>
                            <AdminPillarsPage />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path={PageRoutes.ADMIN_ORGANIZATION_SEGMENT}
                        element={
                          <ProtectedRoute requiredRole={Role.SUPER_ADMIN}>
                            <OrganizationPage />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path={PageRoutes.ADMIN_AUDIT_LOG_SEGMENT}
                        element={
                          <ProtectedRoute requiredRole={Role.SUPER_ADMIN}>
                            <AuditLogPage />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path={PageRoutes.ADMIN_PROJECTS_SEGMENT}
                        element={
                          <ProtectedRoute requiredRole={Role.ADMIN}>
                            <AdminProjectsPage />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path={PageRoutes.ADMIN_PROJECT_DETAIL_SEGMENT}
                        element={
                          <ProtectedRoute requiredRole={Role.ADMIN}>
                            <AdminProjectDetailPage />
                          </ProtectedRoute>
                        }
                      />
                    </Route>
                  </Routes>
                </Suspense>
              </ProfileGuard>
            </BrowserRouter>
          </MotionConfig>
        </AuthProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
