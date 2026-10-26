import { z } from "zod";

import { AuditAction, AuditEntityType, MemberFieldType, Role } from "@/constants/enums";

export const loginSchema = z.object({
  email: z.email({ message: "Invalid email address" }),
  password: z.string().min(1, { message: "Password is required" }),
});

export type LoginSchema = z.infer<typeof loginSchema>;

export const customFieldValuesSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.null()])
);

export type CustomFieldValuesPayload = z.infer<typeof customFieldValuesSchema>;

export const MEMBER_FIELD_RESERVED_KEYS = [
  "id",
  "name",
  "email",
  "role",
  "imageUrl",
  "image_url",
  "isAlumni",
  "is_alumni",
  "activationStartDate",
  "activation_start_date",
  "activationEndDate",
  "activation_end_date",
  "createdAt",
  "profileCompleted",
  "customFields",
] as const;

export const memberFieldSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9_]{0,63}$/, {
      message: "Key must start with a lowercase letter and contain only letters, numbers and _",
    })
    .refine((k) => !MEMBER_FIELD_RESERVED_KEYS.includes(k as never), {
      message: "This key is reserved",
    }),
  label: z.string().min(1, { message: "Label is required" }).max(255),
  type: z.enum(Object.values(MemberFieldType) as [MemberFieldType, ...MemberFieldType[]]),
  required: z.boolean().default(false),
  suggestions: z.boolean().default(false),
});

export type MemberFieldPayload = z.infer<typeof memberFieldSchema>;

export const updateMemberFieldSchema = z
  .object({
    label: z.string().min(1, { message: "Label is required" }).max(255).optional(),
    required: z.boolean().optional(),
    suggestions: z.boolean().optional(),
  })
  .refine((d) => d.label !== undefined || d.required !== undefined || d.suggestions !== undefined, {
    message: "At least one field must be provided",
  });

export type UpdateMemberFieldPayload = z.infer<typeof updateMemberFieldSchema>;

export const memberFieldReorderSchema = z.object({
  ids: z.array(z.uuid()).min(1),
});

export const registerSchema = z.object({
  name: z.string().min(2, { message: "Name must be at least 2 characters" }),
  email: z.email({ message: "Invalid email address" }),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters" })
    .regex(/[a-zA-Z]/, { message: "Password must contain at least one letter" })
    .regex(/[0-9]/, { message: "Password must contain at least one number" }),
  customFields: customFieldValuesSchema.default({}),
});

export type RegisterSchema = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({
  email: z.email({ message: "Invalid email address" }),
});

export type ForgotPasswordSchema = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters" })
    .regex(/[a-zA-Z]/, { message: "Password must contain at least one letter" })
    .regex(/[0-9]/, { message: "Password must contain at least one number" }),
});

export type ResetPasswordSchema = z.infer<typeof resetPasswordSchema>;

export const updateUserSchema = z
  .object({
    role: z.enum(Object.values(Role) as [Role, ...Role[]]).optional(),
    isAlumni: z.boolean().optional(),
  })
  .refine((data) => data.role !== undefined || data.isAlumni !== undefined, {
    message: "At least one field must be provided",
  });

export type UpdateUserPayload = z.infer<typeof updateUserSchema>;

export const createActivationSchema = z
  .object({
    startDate: z.iso.date(),
    endDate: z.iso.date(),
  })
  .refine((d) => d.startDate <= d.endDate, {
    message: "End date must be on or after start date",
    path: ["endDate"],
  });

export type CreateActivationPayload = z.infer<typeof createActivationSchema>;

export const updateActivationSchema = z
  .object({
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
  })
  .refine((data) => data.startDate !== undefined || data.endDate !== undefined, {
    message: "At least one field must be provided",
  })
  .refine((d) => !d.startDate || !d.endDate || d.startDate <= d.endDate, {
    message: "End date must be on or after start date",
    path: ["endDate"],
  });

export type UpdateActivationPayload = z.infer<typeof updateActivationSchema>;

export const positionSchema = z.object({
  title: z.string().min(1, "Title is required"),
  userId: z.uuid("User must be a valid user"),
});

export const positionReorderSchema = z.object({
  ids: z.array(z.uuid()).min(1, "At least one position required"),
});

export type PositionFormValues = z.infer<typeof positionSchema>;

const HTTP_PROTOCOL = /^https?$/;

export const supporterSchema = z.object({
  name: z.string().min(1, "Name is required").max(255, "Name is too long"),
  logoUrl: z.url({ protocol: HTTP_PROTOCOL, error: "Logo is required" }).max(2048),
  websiteUrl: z
    .url({ protocol: HTTP_PROTOCOL, error: "Must be a valid http(s) URL" })
    .max(2048, "URL is too long")
    .nullable()
    .optional(),
});

export const supporterReorderSchema = z.object({
  ids: z.array(z.uuid()).min(1, "At least one supporter required"),
});

export type SupporterFormValues = z.infer<typeof supporterSchema>;

export const pillarSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  directorId: z.uuid("Director must be a valid user"),
  imageUrl: z.url().nullable().optional(),
});

export const updatePillarSchema = pillarSchema
  .partial()
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.directorId !== undefined ||
      data.imageUrl !== undefined,
    { message: "At least one field must be provided" }
  );

export type PillarFormValues = z.infer<typeof pillarSchema>;

export const projectSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    description: z.string().default(""),
    startingAt: z.iso.datetime({ message: "Starting date is required" }),
    endingAt: z.iso.datetime().nullable().optional(),
    pillarId: z.uuid().nullable().optional(),
    imageUrls: z.array(z.url()).default([]),
    registrationOpensAt: z.iso.datetime().nullable().optional(),
    registrationClosesAt: z.iso.datetime().nullable().optional(),
    maxParticipants: z.number().int().min(1).nullable().optional(),
    activeMembersOnly: z.boolean().default(false),
    isPinned: z.boolean().default(false),
  })
  .refine(
    (data) => !(!data.registrationOpensAt && (data.registrationClosesAt || data.maxParticipants)),
    { message: "Registration open date is required when close date or max participants is set" }
  )
  .refine(
    (data) =>
      !(
        data.registrationOpensAt &&
        data.registrationClosesAt &&
        new Date(data.registrationClosesAt) <= new Date(data.registrationOpensAt)
      ),
    { message: "Registration close date must be after open date", path: ["registrationClosesAt"] }
  )
  .refine((data) => !(data.endingAt && new Date(data.endingAt) <= new Date(data.startingAt)), {
    message: "Ending date must be after starting date",
    path: ["endingAt"],
  });

export const updateProjectSchema = z
  .object({
    title: z.string().min(1, "Title is required").optional(),
    description: z.string().optional(),
    startingAt: z.iso.datetime().optional(),
    endingAt: z.iso.datetime().nullable().optional(),
    pillarId: z.uuid().nullable().optional(),
    imageUrls: z.array(z.url()).optional(),
    registrationOpensAt: z.iso.datetime().nullable().optional(),
    registrationClosesAt: z.iso.datetime().nullable().optional(),
    maxParticipants: z.number().int().min(1).nullable().optional(),
    activeMembersOnly: z.boolean().optional(),
    isPinned: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.startingAt !== undefined ||
      data.endingAt !== undefined ||
      data.pillarId !== undefined ||
      data.imageUrls !== undefined ||
      data.registrationOpensAt !== undefined ||
      data.registrationClosesAt !== undefined ||
      data.maxParticipants !== undefined ||
      data.activeMembersOnly !== undefined ||
      data.isPinned !== undefined,
    { message: "At least one field must be provided" }
  )
  .refine(
    (data) =>
      !(
        data.registrationOpensAt === null &&
        (data.registrationClosesAt != null || data.maxParticipants != null)
      ),
    { message: "Registration open date is required when close date or max participants is set" }
  )
  .refine(
    (data) =>
      !(
        data.registrationOpensAt &&
        data.registrationClosesAt &&
        new Date(data.registrationClosesAt) <= new Date(data.registrationOpensAt)
      ),
    { message: "Registration close date must be after open date", path: ["registrationClosesAt"] }
  )
  .refine(
    (data) =>
      !(data.endingAt && data.startingAt && new Date(data.endingAt) <= new Date(data.startingAt)),
    { message: "Ending date must be after starting date", path: ["endingAt"] }
  );

export type ProjectFormValues = z.infer<typeof projectSchema>;

export const workshopSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    description: z.string().default(""),
    startingAt: z.iso.datetime({ message: "Starting date is required" }),
    endingAt: z.iso.datetime().nullable().optional(),
    registrationOpensAt: z.iso.datetime().nullable().optional(),
    registrationClosesAt: z.iso.datetime().nullable().optional(),
    maxParticipants: z.number().int().min(1).nullable().optional(),
  })
  .refine((data) => !(data.endingAt && new Date(data.endingAt) <= new Date(data.startingAt)), {
    message: "Ending date must be after starting date",
    path: ["endingAt"],
  })
  .refine(
    (data) =>
      !(
        data.registrationOpensAt &&
        data.registrationClosesAt &&
        new Date(data.registrationClosesAt) <= new Date(data.registrationOpensAt)
      ),
    { message: "Registration close date must be after open date", path: ["registrationClosesAt"] }
  );

export type WorkshopFormValues = z.infer<typeof workshopSchema>;

export const updateWorkshopSchema = z
  .object({
    title: z.string().min(1, "Title is required").optional(),
    description: z.string().optional(),
    startingAt: z.iso.datetime().optional(),
    endingAt: z.iso.datetime().nullable().optional(),
    registrationOpensAt: z.iso.datetime().nullable().optional(),
    registrationClosesAt: z.iso.datetime().nullable().optional(),
    maxParticipants: z.number().int().min(1).nullable().optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.startingAt !== undefined ||
      data.endingAt !== undefined ||
      data.registrationOpensAt !== undefined ||
      data.registrationClosesAt !== undefined ||
      data.maxParticipants !== undefined,
    { message: "At least one field must be provided" }
  )
  .refine(
    (data) =>
      !(data.endingAt && data.startingAt && new Date(data.endingAt) <= new Date(data.startingAt)),
    { message: "Ending date must be after starting date", path: ["endingAt"] }
  )
  .refine(
    (data) =>
      !(
        data.registrationOpensAt &&
        data.registrationClosesAt &&
        new Date(data.registrationClosesAt) <= new Date(data.registrationOpensAt)
      ),
    { message: "Registration close date must be after open date", path: ["registrationClosesAt"] }
  );

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const updateMeSchema = z
  .object({
    name: z.string().min(2, { message: "Name must be at least 2 characters" }).optional(),
    imageUrl: z.url({ message: "Image URL must be a valid URL" }).optional().nullable(),
    customFields: customFieldValuesSchema.optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined || data.imageUrl !== undefined || data.customFields !== undefined,
    { message: "At least one field must be provided" }
  );

export type UpdateMePayload = z.infer<typeof updateMeSchema>;

export const updateOrganizationSchema = z
  .object({
    name: z.string().min(1, "Organization name is required").optional(),
    tagline: z.string().max(255).nullable().optional(),
    logoUrl: z.url().nullable().optional(),
    description: z.string().optional(),
    aboutUs: z.string().optional(),
    instagramUrl: z.url().nullable().optional(),
    facebookUrl: z.url().nullable().optional(),
    location: z.string().nullable().optional(),
    email: z.email().nullable().optional(),
    phone: z.string().nullable().optional(),
    pillarLabel: z.string().min(1).max(64).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.tagline !== undefined ||
      data.logoUrl !== undefined ||
      data.description !== undefined ||
      data.aboutUs !== undefined ||
      data.instagramUrl !== undefined ||
      data.facebookUrl !== undefined ||
      data.location !== undefined ||
      data.email !== undefined ||
      data.phone !== undefined ||
      data.pillarLabel !== undefined,
    { message: "At least one field must be provided" }
  );

export const setupPasswordSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters" })
    .regex(/[a-zA-Z]/, { message: "Password must contain at least one letter" })
    .regex(/[0-9]/, { message: "Password must contain at least one number" }),
});

export type SetupPasswordPayload = z.infer<typeof setupPasswordSchema>;

export const bulkImportRowSchema = z
  .object({
    name: z.string().min(2, { message: "Name must be at least 2 characters" }),
    email: z.email({ message: "Invalid email address" }),
    role: z
      .enum(Object.values(Role) as [Role, ...Role[]])
      .optional()
      .default(Role.USER),
    imageUrl: z.url({ message: "Invalid image URL" }).optional(),
    customFields: customFieldValuesSchema.optional(),
    isAlumni: z.boolean().optional().default(false),
    activationStartDate: z.iso.date().optional(),
    activationEndDate: z.iso.date().optional(),
  })
  .refine((d) => !!d.activationStartDate === !!d.activationEndDate, {
    message: "Both activation dates must be provided or both omitted",
  })
  .refine(
    (d) =>
      !d.activationStartDate ||
      !d.activationEndDate ||
      d.activationEndDate >= d.activationStartDate,
    { message: "activationEndDate must be on or after activationStartDate" }
  );

export type BulkImportRow = z.infer<typeof bulkImportRowSchema>;

export const resendWelcomeEmailsSchema = z.object({
  userIds: z.array(z.uuid()).min(1, "At least one user ID is required"),
});

export type ResendWelcomeEmailsPayload = z.infer<typeof resendWelcomeEmailsSchema>;

export const bulkImportSchema = z.object({
  users: z.array(bulkImportRowSchema).min(1).max(500),
  sendWelcomeEmails: z.boolean().default(true),
});

export type BulkImportPayload = z.infer<typeof bulkImportSchema>;

export const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  entityType: z
    .enum(Object.values(AuditEntityType) as [AuditEntityType, ...AuditEntityType[]])
    .optional(),
  action: z.enum(Object.values(AuditAction) as [AuditAction, ...AuditAction[]]).optional(),
  actorId: z.uuid().optional(),
  entityId: z.string().max(64).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  q: z.string().trim().max(200).optional(),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
