import type { AuditLogQuery } from "@/constants/schemas";

export const queryKeys = {
  organization: () => ["organization"] as const,
  me: () => ["me"] as const,
  myPoints: () => ["me", "points"] as const,
  positions: () => ["positions"] as const,
  supporters: () => ["supporters"] as const,
  publicProjects: () => ["public-projects"] as const,
  publicPillars: () => ["public-pillars"] as const,
  publicProject: (id: string) => ["public-project", id] as const,
  publicPillar: (id: string) => ["public-pillar", id] as const,
  gallery: () => ["gallery"] as const,
  memberFields: () => ["member-fields"] as const,
  memberFieldSuggestions: (key: string) => ["member-field-suggestions", key] as const,
  myRegistration: (projectId: string) => ["my-registration", projectId] as const,
  publicWorkshops: (projectId: string) => ["public-workshops", projectId] as const,
  myWorkshopRegistration: (workshopId: string) => ["my-workshop-registration", workshopId] as const,
  admin: {
    users: () => ["admin", "users"] as const,
    userPoints: (userId: string) => ["admin", "users", userId, "points"] as const,
    projects: () => ["admin", "projects"] as const,
    pillars: () => ["admin", "pillars"] as const,
    organization: () => ["admin", "organization"] as const,
    dashboard: () => ["admin", "dashboard"] as const,
    auditLogs: (query: AuditLogQuery) => ["admin", "audit-logs", query] as const,
    auditLogActors: () => ["admin", "audit-logs", "actors"] as const,
    projectRegistrations: (projectId: string) =>
      ["admin", "projects", projectId, "registrations"] as const,
    projectPackages: (projectId: string) => ["admin", "projects", projectId, "packages"] as const,
    projectCapacityPools: (projectId: string) =>
      ["admin", "projects", projectId, "capacity-pools"] as const,
    workshops: (projectId: string) => ["admin", "projects", projectId, "workshops"] as const,
    workshopRegistrations: (workshopId: string) =>
      ["admin", "workshops", workshopId, "registrations"] as const,
  },
};
