import type { AuditAction, AuditEntityType, MemberFieldType, Role } from "@/constants/enums";

export type ImageEntry =
  | { type: "none" }
  | { type: "existing"; url: string }
  | { type: "new"; file: File; previewUrl: string };

export type ActiveImageEntry = Exclude<ImageEntry, { type: "none" }>;

export interface MemberFieldDefinition {
  id: string;
  key: string;
  label: string;
  type: MemberFieldType;
  required: boolean;
  suggestions: boolean;
  order: number;
  createdAt: string;
}

export type CustomFieldValues = Record<string, string | number | null>;

export interface UserActivation {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  createdAt: string;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  customFields: Record<string, string | number>;
  profileCompleted: boolean;
  role: Role;
  isAlumni: boolean;
  isActive: boolean;
  activations: UserActivation[];
  imageUrl: string | null;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: Role;
  imageUrl: string | null;
  customFields: Record<string, string | number>;
  profileCompleted: boolean;
  isAlumni: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  startingAt: string;
  endingAt: string | null;
  pillarId: string | null;
  pillarName: string | null;
  images: string[];
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  maxParticipants: number | null;
  activeMembersOnly: boolean;
  isPinned: boolean;
  packages: ProjectPackage[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCapacityPool {
  id: string;
  projectId: string;
  name: string;
  maxParticipants: number;
  createdAt: string;
}

export interface ProjectPackage {
  id: string;
  projectId: string;
  capacityPoolId: string | null;
  capacityPoolName: string | null;
  capacityPoolMax: number | null;
  name: string;
  description: string;
  maxParticipants: number | null;
  availableSpots: number | null;
  order: number;
  createdAt: string;
}

export interface PublicProjectPackage {
  id: string;
  name: string;
  description: string;
  order: number;
  canRegister: boolean;
}

export interface ProjectRegistration {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  packageId: string | null;
  packageName: string | null;
  attended: boolean;
  certificateUrl: string | null;
  certificateFilename: string | null;
  createdAt: string;
}

export interface OrganizationPublic {
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  description: string;
  aboutUs: string;
  instagramUrl: string | null;
  facebookUrl: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  pillarLabel: string;
}

export interface PublicProject {
  id: string;
  title: string;
  description: string;
  startingAt: string;
  endingAt: string | null;
  pillarId: string | null;
  pillarName: string | null;
  images: string[];
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  activeMembersOnly: boolean;
  isPinned: boolean;
  canRegister: boolean;
  packages: PublicProjectPackage[];
}

export interface MyRegistration {
  registered: boolean;
  id?: string;
  packageId?: string | null;
  packageName?: string | null;
  createdAt?: string;
  certificateUrl?: string | null;
  certificateFilename?: string | null;
}

export interface PublicPillar {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  directorName: string | null;
  directorImageUrl: string | null;
}

export interface PublicPillarDetail extends PublicPillar {
  projects: PublicProject[];
}

export interface Organization {
  id: number;
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  description: string;
  aboutUs: string;
  instagramUrl: string | null;
  facebookUrl: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  pillarLabel: string;
  updatedAt: string;
}

export interface DashboardStats {
  users: { total: number; active: number; inactive: number };
  projects: {
    total: number;
    upcoming: number;
    thisMonth: number;
    next: { title: string; startingAt: string } | null;
  };
  pillars: { total: number };
}

export interface Pillar {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  directorId: string;
  directorName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicPosition {
  id: string;
  title: string;
  userName: string;
  userImageUrl: string | null;
  order: number;
}

export interface Position {
  id: string;
  title: string;
  userId: string;
  userName: string;
  userImageUrl: string | null;
  order: number;
  createdAt: string;
}

export interface Supporter {
  id: string;
  name: string;
  logoUrl: string;
  websiteUrl: string | null;
  order: number;
  createdAt: string;
}

export type RegistrationStatus = "none" | "not_open" | "open" | "full" | "closed";

export interface Workshop {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  startingAt: string;
  endingAt: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  maxParticipants: number | null;
  registeredCount: number;
  availableSpots: number | null;
  myRegistration: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkshopRegistration {
  id: string;
  workshopId: string;
  userId: string;
  userName: string;
  userEmail: string;
  attended: boolean;
  createdAt: string;
}

export interface GalleryImage {
  url: string;
  label: string;
}

export interface GalleryResponse {
  images: GalleryImage[];
  total: number;
  hasMore: boolean;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string;
}

export type AuditValue = string | number | boolean | null;

export type AuditChanges = Record<string, { from: AuditValue; to: AuditValue }>;

export type AuditMetadata = Record<string, AuditValue | string[]>;

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorName: string;
  actorEmail: string;
  actorImageUrl: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string | null;
  entityLabel: string;
  changes: AuditChanges | null;
  metadata: AuditMetadata | null;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  total: number;
}

export interface AuditActor {
  id: string;
  name: string;
}
