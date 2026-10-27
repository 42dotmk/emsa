import { relations } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  type AuditAction,
  type AuditEntityType,
  MemberFieldType,
  type PointReason,
  Role,
} from "@/constants/enums";
import type { AuditChanges, AuditMetadata, PointContext } from "@/constants/types";

function jsonbOf<T>() {
  return customType<{ data: T }>({
    dataType() {
      return "jsonb";
    },
    toDriver(value) {
      return value;
    },
    fromDriver(value) {
      return typeof value === "string" ? JSON.parse(value) : (value as T);
    },
  });
}

const jsonbObject = jsonbOf<Record<string, string | number>>();
const jsonbAuditChanges = jsonbOf<AuditChanges>();
const jsonbAuditMetadata = jsonbOf<AuditMetadata>();
const jsonbPointContext = jsonbOf<PointContext>();

export const roleEnum = pgEnum("role", [Role.USER, Role.ADMIN, Role.SUPER_ADMIN]);

export const memberFieldTypeEnum = pgEnum("member_field_type", [
  MemberFieldType.TEXT,
  MemberFieldType.NUMBER,
]);

export const memberFieldDefinitions = pgTable("member_field_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 64 }).notNull().unique(),
  label: varchar("label", { length: 255 }).notNull(),
  type: memberFieldTypeEnum("type").notNull().default(MemberFieldType.TEXT),
  required: boolean("required").notNull().default(false),
  suggestions: boolean("suggestions").notNull().default(false),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash"),
  googleId: varchar("google_id", { length: 255 }).unique(),
  role: roleEnum("role").notNull().default(Role.USER),
  imageUrl: varchar("image_url", { length: 2048 }),
  customFields: jsonbObject("custom_fields").notNull().default({}),
  profileCompleted: boolean("profile_completed").notNull().default(false),
  isAlumni: boolean("is_alumni").notNull().default(false),
  pointsBalance: integer("points_balance").notNull().default(0),
  membershipPointsHeld: integer("membership_points_held").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pillars = pgTable("pillars", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description").notNull(),
  directorId: uuid("director_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  imageUrl: varchar("image_url", { length: 2048 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pillarsRelations = relations(pillars, ({ one }) => ({
  director: one(users, { fields: [pillars.directorId], references: [users.id] }),
}));

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull().default(""),
  startingAt: timestamp("starting_at", { withTimezone: true }).notNull(),
  endingAt: timestamp("ending_at", { withTimezone: true }),
  pillarId: uuid("pillar_id").references(() => pillars.id, { onDelete: "set null" }),
  registrationOpensAt: timestamp("registration_opens_at", { withTimezone: true }),
  registrationClosesAt: timestamp("registration_closes_at", { withTimezone: true }),
  maxParticipants: integer("max_participants"),
  activeMembersOnly: boolean("active_members_only").notNull().default(false),
  isPinned: boolean("is_pinned").notNull().default(false),
  points: integer("points"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectImages = pgTable("project_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  url: varchar("url", { length: 2048 }).notNull(),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectCapacityPools = pgTable("project_capacity_pools", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  maxParticipants: integer("max_participants").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectPackages = pgTable("project_packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  capacityPoolId: uuid("capacity_pool_id").references(() => projectCapacityPools.id, {
    onDelete: "set null",
  }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description").notNull().default(""),
  maxParticipants: integer("max_participants"),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectRegistrations = pgTable(
  "project_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    packageId: uuid("package_id").references(() => projectPackages.id, { onDelete: "set null" }),
    attended: boolean("attended").notNull().default(false),
    pointsAwarded: integer("points_awarded").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("project_registrations_project_user_unique").on(table.projectId, table.userId),
    index("project_registrations_project_id_idx").on(table.projectId),
  ]
);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  pillar: one(pillars, { fields: [projects.pillarId], references: [pillars.id] }),
  images: many(projectImages),
  registrations: many(projectRegistrations),
  capacityPools: many(projectCapacityPools),
  packages: many(projectPackages),
}));

export const projectCapacityPoolsRelations = relations(projectCapacityPools, ({ one, many }) => ({
  project: one(projects, { fields: [projectCapacityPools.projectId], references: [projects.id] }),
  packages: many(projectPackages),
}));

export const projectPackagesRelations = relations(projectPackages, ({ one, many }) => ({
  project: one(projects, { fields: [projectPackages.projectId], references: [projects.id] }),
  capacityPool: one(projectCapacityPools, {
    fields: [projectPackages.capacityPoolId],
    references: [projectCapacityPools.id],
  }),
  registrations: many(projectRegistrations),
}));

export const registrationCertificates = pgTable("registration_certificates", {
  id: uuid("id").primaryKey().defaultRandom(),
  registrationId: uuid("registration_id")
    .notNull()
    .unique()
    .references(() => projectRegistrations.id, { onDelete: "cascade" }),
  url: varchar("url", { length: 2048 }).notNull(),
  filename: varchar("filename", { length: 500 }).notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectRegistrationsRelations = relations(projectRegistrations, ({ one }) => ({
  project: one(projects, { fields: [projectRegistrations.projectId], references: [projects.id] }),
  user: one(users, { fields: [projectRegistrations.userId], references: [users.id] }),
  package: one(projectPackages, {
    fields: [projectRegistrations.packageId],
    references: [projectPackages.id],
  }),
  certificate: one(registrationCertificates, {
    fields: [projectRegistrations.id],
    references: [registrationCertificates.registrationId],
  }),
}));

export const registrationCertificatesRelations = relations(registrationCertificates, ({ one }) => ({
  registration: one(projectRegistrations, {
    fields: [registrationCertificates.registrationId],
    references: [projectRegistrations.id],
  }),
}));

export const projectImagesRelations = relations(projectImages, ({ one }) => ({
  project: one(projects, { fields: [projectImages.projectId], references: [projects.id] }),
}));

export const positions = pgTable("positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const positionsRelations = relations(positions, ({ one }) => ({
  user: one(users, { fields: [positions.userId], references: [users.id] }),
}));

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accountSetupTokens = pgTable("account_setup_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userActivations = pgTable("user_activations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  activations: many(userActivations),
}));

export const userActivationsRelations = relations(userActivations, ({ one }) => ({
  user: one(users, { fields: [userActivations.userId], references: [users.id] }),
}));

export const workshops = pgTable("workshops", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  startingAt: timestamp("starting_at", { withTimezone: true }).notNull(),
  endingAt: timestamp("ending_at", { withTimezone: true }),
  registrationOpensAt: timestamp("registration_opens_at", { withTimezone: true }),
  registrationClosesAt: timestamp("registration_closes_at", { withTimezone: true }),
  maxParticipants: integer("max_participants"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workshopRegistrations = pgTable(
  "workshop_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workshopId: uuid("workshop_id")
      .notNull()
      .references(() => workshops.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    attended: boolean("attended").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workshop_registrations_workshop_user_unique").on(table.workshopId, table.userId),
    index("workshop_registrations_workshop_id_idx").on(table.workshopId),
  ]
);

export const workshopsRelations = relations(workshops, ({ one, many }) => ({
  project: one(projects, { fields: [workshops.projectId], references: [projects.id] }),
  registrations: many(workshopRegistrations),
}));

export const workshopRegistrationsRelations = relations(workshopRegistrations, ({ one }) => ({
  workshop: one(workshops, {
    fields: [workshopRegistrations.workshopId],
    references: [workshops.id],
  }),
  user: one(users, { fields: [workshopRegistrations.userId], references: [users.id] }),
}));

export const organization = pgTable("organization", {
  id: integer("id").primaryKey().default(1),
  name: varchar("name", { length: 255 }).notNull().default(""),
  tagline: varchar("tagline", { length: 255 }),
  logoUrl: varchar("logo_url", { length: 2048 }),
  description: text("description").notNull().default(""),
  aboutUs: text("about_us").notNull().default(""),
  instagramUrl: varchar("instagram_url", { length: 2048 }),
  facebookUrl: varchar("facebook_url", { length: 2048 }),
  location: varchar("location", { length: 500 }),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  pillarLabel: varchar("pillar_label", { length: 64 }).notNull().default("Pillar"),
  pointsEnabled: boolean("points_enabled").notNull().default(false),
  pointsName: varchar("points_name", { length: 64 }).notNull().default("Points"),
  pointsIconUrl: varchar("points_icon_url", { length: 2048 }),
  membershipPoints: integer("membership_points").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const supporters = pgTable("supporters", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  logoUrl: varchar("logo_url", { length: 2048 }).notNull(),
  websiteUrl: varchar("website_url", { length: 2048 }),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorName: varchar("actor_name", { length: 255 }).notNull(),
    actorEmail: varchar("actor_email", { length: 255 }).notNull(),
    action: varchar("action", { length: 32 }).$type<AuditAction>().notNull(),
    entityType: varchar("entity_type", { length: 32 }).$type<AuditEntityType>().notNull(),
    entityId: varchar("entity_id", { length: 64 }),
    entityLabel: varchar("entity_label", { length: 500 }).notNull(),
    changes: jsonbAuditChanges("changes"),
    metadata: jsonbAuditMetadata("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_created_at_idx").on(table.createdAt.desc()),
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
    index("audit_logs_actor_id_idx").on(table.actorId),
  ]
);

export const pointTransactions = pgTable(
  "point_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    reason: varchar("reason", { length: 32 }).$type<PointReason>().notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    projectTitle: varchar("project_title", { length: 255 }),
    note: text("note"),
    context: jsonbPointContext("context"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdByName: varchar("created_by_name", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("point_transactions_user_created_idx").on(table.userId, table.createdAt.desc())]
);
