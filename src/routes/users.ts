import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne } from "drizzle-orm";

import { AuditAction, AuditEntityType, Role } from "@/constants/enums";
import { ApiRoutes } from "@/constants/routes";
import {
  bulkImportSchema,
  createActivationSchema,
  resendWelcomeEmailsSchema,
  updateActivationSchema,
  updateMeSchema,
  updateUserSchema,
} from "@/constants/schemas";
import {
  memberFieldDefinitions,
  pillars,
  positions,
  projectRegistrations,
  registrationCertificates,
  userActivations,
  users,
} from "@/db/schema";
import {
  createdChanges,
  deletedChanges,
  diffChanges,
  lookupUserName,
  recordAudit,
} from "@/lib/audit";
import { db } from "@/lib/db";
import { sendBulkWelcomeEmails } from "@/lib/email";
import { createUserToken } from "@/lib/jwt";
import {
  buildCustomFieldsSchema,
  cleanCustomFieldValues,
  computeProfileCompleted,
  firstIssueMessage,
} from "@/lib/member-fields";
import { HttpError, parseBody, withRole } from "@/lib/middleware";
import { syncMembershipPoints } from "@/lib/points";
import { deleteObject, getPresignedUploadUrl, validateImageContentType } from "@/lib/s3";

const meColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  imageUrl: users.imageUrl,
  customFields: users.customFields,
  profileCompleted: users.profileCompleted,
  isAlumni: users.isAlumni,
  pointsBalance: users.pointsBalance,
  createdAt: users.createdAt,
};

const adminUserColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  customFields: users.customFields,
  profileCompleted: users.profileCompleted,
  role: users.role,
  isAlumni: users.isAlumni,
  imageUrl: users.imageUrl,
  pointsBalance: users.pointsBalance,
  createdAt: users.createdAt,
};

async function getFieldDefinitions() {
  return db.select().from(memberFieldDefinitions).orderBy(asc(memberFieldDefinitions.order));
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function activePeriodCondition(date: string) {
  return and(
    eq(userActivations.userId, users.id),
    lte(userActivations.startDate, date),
    gte(userActivations.endDate, date)
  );
}

// Self
const getMe = withRole(
  Role.USER,
  async (_req, user) => {
    const today = todayStr();
    const [me] = await db
      .select({ ...meColumns, isActive: isNotNull(userActivations.id) })
      .from(users)
      .leftJoin(userActivations, activePeriodCondition(today))
      .where(eq(users.id, user.sub))
      .limit(1);

    if (!me) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    return Response.json(me);
  },
  { allowIncomplete: true }
);

const updateMe = withRole(
  Role.USER,
  async (req, user) => {
    const data = await parseBody(req, updateMeSchema);

    const [current] = await db
      .select({
        customFields: users.customFields,
        profileCompleted: users.profileCompleted,
        imageUrl: users.imageUrl,
      })
      .from(users)
      .where(eq(users.id, user.sub))
      .limit(1);

    if (!current) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    const defs = await getFieldDefinitions();

    let customFields = current.customFields;
    if (data.customFields !== undefined) {
      const result = buildCustomFieldsSchema(defs, { enforceRequired: false }).safeParse(
        data.customFields
      );
      if (!result.success) {
        throw new HttpError(400, firstIssueMessage(result.error));
      }
      customFields = cleanCustomFieldValues(defs, { ...current.customFields, ...result.data });
    }
    const profileCompleted = computeProfileCompleted(defs, customFields);

    const today = todayStr();
    const [updated] = await db
      .update(users)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl }),
        customFields,
        profileCompleted,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.sub))
      .returning(meColumns);

    if (!updated) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    if (current.imageUrl && data.imageUrl !== undefined && data.imageUrl !== current.imageUrl) {
      deleteObject(current.imageUrl).catch(console.error);
    }

    const [activeRow] = await db
      .select({ isActive: isNotNull(userActivations.id) })
      .from(users)
      .leftJoin(userActivations, activePeriodCondition(today))
      .where(eq(users.id, user.sub))
      .limit(1);

    const isActive = activeRow?.isActive ?? false;

    if (profileCompleted === current.profileCompleted) {
      return Response.json({ ...updated, isActive });
    }

    // profileCompleted changed — re-issue JWT so the client is in sync
    const token = await createUserToken({
      id: user.sub,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      profileCompleted,
    });

    return Response.json({ ...updated, isActive, token });
  },
  { allowIncomplete: true }
);

const getPresignedUrl = withRole(
  Role.USER,
  async (req) => {
    const contentType = new URL(req.url).searchParams.get("contentType") ?? "image/jpeg";
    const ext = validateImageContentType(contentType);
    const { uploadUrl, fileUrl } = await getPresignedUploadUrl(
      `avatars/${crypto.randomUUID()}.${ext}`,
      contentType
    );
    return Response.json({ uploadUrl, fileUrl });
  },
  { allowIncomplete: true }
);

// Admin
const getUsers = withRole(Role.ADMIN, async () => {
  const today = todayStr();
  const [allUsers, allActivations] = await Promise.all([
    db.select(adminUserColumns).from(users).orderBy(asc(users.createdAt)),
    db.select().from(userActivations).orderBy(desc(userActivations.startDate)),
  ]);

  const activationsByUser = new Map<string, typeof allActivations>();
  for (const a of allActivations) {
    const list = activationsByUser.get(a.userId) ?? [];
    list.push(a);
    activationsByUser.set(a.userId, list);
  }

  return Response.json(
    allUsers.map((u) => {
      const activations = activationsByUser.get(u.id) ?? [];
      return {
        ...u,
        activations,
        isActive: activations.some((a) => a.startDate <= today && a.endDate >= today),
      };
    })
  );
});

const updateUser = withRole<{ id: string }>(Role.SUPER_ADMIN, async (req, user) => {
  const { id } = req.params;
  const data = await parseBody(req, updateUserSchema);

  const [before] = await db
    .select({ role: users.role, isAlumni: users.isAlumni })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (data.role && data.role !== Role.SUPER_ADMIN) {
    const [target] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!target) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }
    if (target.role === Role.SUPER_ADMIN) {
      const [other] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, Role.SUPER_ADMIN), ne(users.id, id)))
        .limit(1);
      if (!other) {
        throw new HttpError(422, "Cannot demote the only super admin");
      }
    }
  }

  const [updated] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning(adminUserColumns);

  if (!updated) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const changes = diffChanges(before ?? {}, { role: updated.role, isAlumni: updated.isAlumni });
  if (changes) {
    await recordAudit(user, {
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.USER,
      entityId: updated.id,
      entityLabel: updated.name,
      changes,
      metadata: { email: updated.email },
    });
  }

  const today = todayStr();
  const activationRows = await db
    .select()
    .from(userActivations)
    .where(eq(userActivations.userId, id))
    .orderBy(desc(userActivations.startDate));

  return Response.json({
    ...updated,
    activations: activationRows,
    isActive: activationRows.some((a) => a.startDate <= today && a.endDate >= today),
  });
});

const deleteUser = withRole<{ id: string }>(Role.SUPER_ADMIN, async (req, user) => {
  const { id } = req.params;

  if (id === user.sub) {
    throw new HttpError(422, "You cannot delete your own account");
  }

  const [directedPillar] = await db
    .select({ name: pillars.name })
    .from(pillars)
    .where(eq(pillars.directorId, id))
    .limit(1);
  if (directedPillar) {
    throw new HttpError(422, `Reassign the director of "${directedPillar.name}" first`);
  }

  const [heldPosition] = await db
    .select({ title: positions.title })
    .from(positions)
    .where(eq(positions.userId, id))
    .limit(1);
  if (heldPosition) {
    throw new HttpError(422, `Remove their board position "${heldPosition.title}" first`);
  }

  const certificates = await db
    .select({ url: registrationCertificates.url })
    .from(registrationCertificates)
    .innerJoin(
      projectRegistrations,
      eq(registrationCertificates.registrationId, projectRegistrations.id)
    )
    .where(eq(projectRegistrations.userId, id));

  let deleted;
  try {
    [deleted] = await db.delete(users).where(eq(users.id, id)).returning(adminUserColumns);
  } catch (err) {
    if ((err as { code?: string }).code === "23503") {
      throw new HttpError(422, "User is still referenced by other records");
    }
    throw err;
  }

  if (!deleted) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  await recordAudit(user, {
    action: AuditAction.DELETE,
    entityType: AuditEntityType.USER,
    entityId: deleted.id,
    entityLabel: deleted.name,
    changes: deletedChanges(deleted),
  });

  if (deleted.imageUrl) {
    deleteObject(deleted.imageUrl).catch(console.error);
  }
  for (const cert of certificates) {
    deleteObject(cert.url).catch(console.error);
  }

  return Response.json({ id: deleted.id });
});

// Activations
async function checkOverlap(
  userId: string,
  startDate: string,
  endDate: string,
  excludeId?: string
): Promise<boolean> {
  const conditions = [
    eq(userActivations.userId, userId),
    lte(userActivations.startDate, endDate),
    gte(userActivations.endDate, startDate),
  ];
  if (excludeId) conditions.push(ne(userActivations.id, excludeId));

  const [overlap] = await db
    .select({ id: userActivations.id })
    .from(userActivations)
    .where(and(...conditions))
    .limit(1);

  return !!overlap;
}

const createActivation = withRole<{ id: string }>(Role.SUPER_ADMIN, async (req, user) => {
  const { id: userId } = req.params;
  const data = await parseBody(req, createActivationSchema);

  const hasOverlap = await checkOverlap(userId, data.startDate, data.endDate);
  if (hasOverlap) {
    return Response.json({ error: "Activation period overlaps an existing one" }, { status: 422 });
  }

  const [activation] = await db
    .insert(userActivations)
    .values({ userId, startDate: data.startDate, endDate: data.endDate })
    .returning();

  if (activation) {
    await recordAudit(user, {
      action: AuditAction.CREATE,
      entityType: AuditEntityType.ACTIVATION,
      entityId: activation.id,
      entityLabel: (await lookupUserName(userId)) ?? userId,
      changes: createdChanges({ startDate: activation.startDate, endDate: activation.endDate }),
      metadata: { userId },
    });
    await syncMembershipPoints(user, [userId]);
  }

  return Response.json(activation, { status: 201 });
});

const updateActivation = withRole<{ id: string }>(Role.SUPER_ADMIN, async (req, user) => {
  const { id: activationId } = req.params;
  const data = await parseBody(req, updateActivationSchema);

  const [existing] = await db
    .select()
    .from(userActivations)
    .where(eq(userActivations.id, activationId))
    .limit(1);

  if (!existing) {
    return Response.json({ error: "Activation not found" }, { status: 404 });
  }

  const newStart = data.startDate ?? existing.startDate;
  const newEnd = data.endDate ?? existing.endDate;

  if (newStart > newEnd) {
    return Response.json({ error: "End date must be on or after start date" }, { status: 400 });
  }

  const hasOverlap = await checkOverlap(existing.userId, newStart, newEnd, activationId);
  if (hasOverlap) {
    return Response.json({ error: "Activation period overlaps an existing one" }, { status: 422 });
  }

  const [updated] = await db
    .update(userActivations)
    .set({ startDate: newStart, endDate: newEnd })
    .where(eq(userActivations.id, activationId))
    .returning();

  const changes = updated ? diffChanges(existing, updated) : null;
  if (changes) {
    await recordAudit(user, {
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.ACTIVATION,
      entityId: activationId,
      entityLabel: (await lookupUserName(existing.userId)) ?? existing.userId,
      changes,
      metadata: { userId: existing.userId },
    });
  }
  await syncMembershipPoints(user, [existing.userId]);

  return Response.json(updated);
});

const deleteActivation = withRole<{ id: string }>(Role.SUPER_ADMIN, async (req, user) => {
  const { id: activationId } = req.params;

  const [deleted] = await db
    .delete(userActivations)
    .where(eq(userActivations.id, activationId))
    .returning();

  if (!deleted) {
    return Response.json({ error: "Activation not found" }, { status: 404 });
  }

  await recordAudit(user, {
    action: AuditAction.DELETE,
    entityType: AuditEntityType.ACTIVATION,
    entityId: deleted.id,
    entityLabel: (await lookupUserName(deleted.userId)) ?? deleted.userId,
    changes: deletedChanges({ startDate: deleted.startDate, endDate: deleted.endDate }),
    metadata: { userId: deleted.userId },
  });
  await syncMembershipPoints(user, [deleted.userId]);

  return Response.json({ id: deleted.id });
});

const bulkImportUsers = withRole(Role.SUPER_ADMIN, async (req, user) => {
  const data = await parseBody(req, bulkImportSchema);

  const defs = await getFieldDefinitions();
  const customFieldsSchema = buildCustomFieldsSchema(defs, { enforceRequired: false });
  for (const u of data.users) {
    const result = customFieldsSchema.safeParse(u.customFields ?? {});
    if (!result.success) {
      throw new HttpError(400, `Row ${u.email}: ${firstIssueMessage(result.error)}`);
    }
  }

  const emails = data.users.map((u) => u.email);
  const existing = await db
    .select({ email: users.email })
    .from(users)
    .where(inArray(users.email, emails));
  const existingEmails = new Set(existing.map((e) => e.email));

  const toCreate = data.users.filter((u) => !existingEmails.has(u.email));
  const skipped = data.users
    .filter((u) => existingEmails.has(u.email))
    .map((u) => ({ email: u.email, reason: "already exists" }));

  if (toCreate.length === 0) {
    return Response.json({ created: 0, skipped });
  }

  const created = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values(
        toCreate.map((u) => {
          const customFields = cleanCustomFieldValues(defs, u.customFields ?? {});
          return {
            name: u.name,
            email: u.email,
            role: u.role ?? Role.USER,
            imageUrl: u.imageUrl ?? null,
            customFields,
            isAlumni: u.isAlumni ?? false,
            profileCompleted: computeProfileCompleted(defs, customFields),
          };
        })
      )
      .returning();

    const toCreateByEmail = new Map(toCreate.map((u) => [u.email, u]));
    const activationRows = inserted.flatMap((row) => {
      const src = toCreateByEmail.get(row.email);
      if (!src?.activationStartDate || !src?.activationEndDate) return [];
      return [
        { userId: row.id, startDate: src.activationStartDate, endDate: src.activationEndDate },
      ];
    });

    if (activationRows.length > 0) {
      await tx.insert(userActivations).values(activationRows);
    }

    return inserted;
  });

  await recordAudit(user, {
    action: AuditAction.IMPORT,
    entityType: AuditEntityType.USER,
    entityLabel: `${created.length} ${created.length === 1 ? "user" : "users"}`,
    metadata: {
      created: created.length,
      skipped: skipped.length,
      welcomeEmails: data.sendWelcomeEmails,
      emails: created.map((u) => u.email),
    },
  });

  if (data.sendWelcomeEmails) {
    await sendBulkWelcomeEmails(created.map((u) => ({ email: u.email, name: u.name })));
  }

  await syncMembershipPoints(
    user,
    created.map((u) => u.id)
  );

  return Response.json({ created: created.length, skipped }, { status: 201 });
});

const resendWelcomeEmails = withRole(Role.SUPER_ADMIN, async (req, user) => {
  const data = await parseBody(req, resendWelcomeEmailsSchema);

  const recipients = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(inArray(users.id, data.userIds));

  if (recipients.length === 0) {
    return Response.json({ error: "No matching users found" }, { status: 404 });
  }

  await sendBulkWelcomeEmails(recipients.map((u) => ({ email: u.email, name: u.name })));

  await recordAudit(user, {
    action: AuditAction.SEND_EMAIL,
    entityType: AuditEntityType.USER,
    entityLabel: `Welcome email to ${recipients.length} ${recipients.length === 1 ? "user" : "users"}`,
    metadata: { count: recipients.length, emails: recipients.map((u) => u.email) },
  });

  return Response.json({ sent: recipients.length });
});

export const userRoutes = {
  [ApiRoutes.USERS_ME]: { GET: getMe, PATCH: updateMe },
  [ApiRoutes.UPLOAD_PRESIGNED]: { GET: getPresignedUrl },
  [ApiRoutes.ADMIN_USERS]: { GET: getUsers },
  [ApiRoutes.ADMIN_USER_BY_ID]: { PATCH: updateUser, DELETE: deleteUser },
  [ApiRoutes.ADMIN_USER_ACTIVATIONS]: { POST: createActivation },
  [ApiRoutes.ADMIN_ACTIVATION_BY_ID]: { PATCH: updateActivation, DELETE: deleteActivation },
  [ApiRoutes.ADMIN_USERS_BULK_IMPORT]: { POST: bulkImportUsers },
  [ApiRoutes.ADMIN_USERS_RESEND_WELCOME]: { POST: resendWelcomeEmails },
};
