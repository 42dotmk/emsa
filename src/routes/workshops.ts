import { and, count, eq, gt, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { AuditAction, AuditEntityType, Role } from "@/constants/enums";
import { ApiRoutes } from "@/constants/routes";
import { updateWorkshopSchema, workshopSchema } from "@/constants/schemas";
import {
  projectRegistrations,
  projects,
  users,
  workshopRegistrations,
  workshops,
} from "@/db/schema";
import {
  createdChanges,
  deletedChanges,
  diffChanges,
  lookupProjectTitle,
  lookupUserName,
  recordAudit,
} from "@/lib/audit";
import { db } from "@/lib/db";
import { type BunRequest, getAuthUser, HttpError, parseBody, withRole } from "@/lib/middleware";

async function workshopMetadata(workshop: { id: string; title: string; projectId: string }) {
  return {
    workshopId: workshop.id,
    workshopTitle: workshop.title,
    projectId: workshop.projectId,
    projectTitle: (await lookupProjectTitle(workshop.projectId)) ?? null,
  };
}

async function buildWorkshopResponse(
  rows: (typeof workshops.$inferSelect)[],
  callerUserId?: string
) {
  if (rows.length === 0) return [];

  const ids = rows.map((w) => w.id);

  const regCounts = await db
    .select({ workshopId: workshopRegistrations.workshopId, count: count() })
    .from(workshopRegistrations)
    .where(inArray(workshopRegistrations.workshopId, ids))
    .groupBy(workshopRegistrations.workshopId);

  const countMap: Record<string, number> = {};
  for (const r of regCounts) countMap[r.workshopId] = r.count;

  let myRegSet = new Set<string>();
  if (callerUserId) {
    const myRegs = await db
      .select({ workshopId: workshopRegistrations.workshopId })
      .from(workshopRegistrations)
      .where(
        and(
          inArray(workshopRegistrations.workshopId, ids),
          eq(workshopRegistrations.userId, callerUserId)
        )
      );
    myRegSet = new Set(myRegs.map((r) => r.workshopId));
  }

  return rows.map((w) => {
    const registeredCount = countMap[w.id] ?? 0;
    const availableSpots =
      w.maxParticipants !== null ? Math.max(0, w.maxParticipants - registeredCount) : null;
    return {
      id: w.id,
      projectId: w.projectId,
      title: w.title,
      description: w.description,
      startingAt: w.startingAt,
      endingAt: w.endingAt,
      registrationOpensAt: w.registrationOpensAt,
      registrationClosesAt: w.registrationClosesAt,
      maxParticipants: w.maxParticipants,
      registeredCount,
      availableSpots,
      myRegistration: myRegSet.has(w.id),
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    };
  });
}

// Public: list workshops for a project
const getProjectWorkshops = async (req: BunRequest<{ id: string }>) => {
  const { id } = req.params;
  const [authUser, rows] = await Promise.all([
    getAuthUser(req as Request),
    db.select().from(workshops).where(eq(workshops.projectId, id)).orderBy(workshops.startingAt),
  ]);

  const result = await buildWorkshopResponse(rows, authUser?.sub);
  return Response.json(result);
};

// User: check my registration for a workshop
const getMyWorkshopRegistration = withRole<{ workshopId: string }>(Role.USER, async (req, user) => {
  const { workshopId } = req.params;

  const [reg] = await db
    .select({ id: workshopRegistrations.id, createdAt: workshopRegistrations.createdAt })
    .from(workshopRegistrations)
    .where(
      and(
        eq(workshopRegistrations.workshopId, workshopId),
        eq(workshopRegistrations.userId, user.sub)
      )
    )
    .limit(1);

  return Response.json(
    reg ? { registered: true, id: reg.id, createdAt: reg.createdAt } : { registered: false }
  );
});

// User: register for a workshop
const registerForWorkshop = withRole<{ workshopId: string }>(Role.USER, async (req, user) => {
  const { workshopId } = req.params;

  const [workshop] = await db.select().from(workshops).where(eq(workshops.id, workshopId)).limit(1);

  if (!workshop) return Response.json({ error: "Workshop not found" }, { status: 404 });

  // User must be registered for the parent project
  const [projectReg] = await db
    .select({ id: projectRegistrations.id })
    .from(projectRegistrations)
    .where(
      and(
        eq(projectRegistrations.projectId, workshop.projectId),
        eq(projectRegistrations.userId, user.sub)
      )
    )
    .limit(1);

  if (!projectReg) {
    return Response.json(
      { error: "You must be registered for the project to register for a workshop" },
      { status: 403 }
    );
  }

  if (!workshop.registrationOpensAt) {
    return Response.json(
      { error: "Registration is not available for this workshop" },
      { status: 422 }
    );
  }

  const now = new Date();

  if (workshop.registrationOpensAt > now) {
    return Response.json({ error: "Registration is not open yet" }, { status: 422 });
  }

  if (workshop.registrationClosesAt && workshop.registrationClosesAt < now) {
    return Response.json({ error: "Registration has closed" }, { status: 422 });
  }

  if (workshop.endingAt !== null) {
    const [conflict] = await db
      .select({ id: workshopRegistrations.id })
      .from(workshopRegistrations)
      .innerJoin(workshops, eq(workshopRegistrations.workshopId, workshops.id))
      .where(
        and(
          eq(workshopRegistrations.userId, user.sub),
          eq(workshops.projectId, workshop.projectId),
          ne(workshops.id, workshopId),
          isNotNull(workshops.endingAt),
          lt(workshops.startingAt, workshop.endingAt),
          gt(workshops.endingAt, workshop.startingAt)
        )
      )
      .limit(1);

    if (conflict) {
      return Response.json(
        { error: "You are already registered for a workshop at an overlapping time" },
        { status: 422 }
      );
    }
  }

  try {
    const [registration] = await db.transaction(async (tx) => {
      if (workshop.maxParticipants !== null) {
        // Advisory lock prevents concurrent over-enrollment on the last spot
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${workshopId}))`);

        const [countRow] = await tx
          .select({ count: count() })
          .from(workshopRegistrations)
          .where(eq(workshopRegistrations.workshopId, workshopId));

        if ((countRow?.count ?? 0) >= workshop.maxParticipants) {
          throw new HttpError(422, "No spots remaining");
        }
      }

      return tx.insert(workshopRegistrations).values({ workshopId, userId: user.sub }).returning();
    });

    return Response.json(registration, { status: 201 });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if ((err as { code?: string }).code === "23505") {
      return Response.json({ error: "Already registered" }, { status: 409 });
    }
    throw err;
  }
});

// User: cancel workshop registration
const unregisterFromWorkshop = withRole<{ workshopId: string }>(Role.USER, async (req, user) => {
  const { workshopId } = req.params;

  const [workshop] = await db
    .select({ registrationClosesAt: workshops.registrationClosesAt })
    .from(workshops)
    .where(eq(workshops.id, workshopId))
    .limit(1);

  if (!workshop) return Response.json({ error: "Workshop not found" }, { status: 404 });

  const now = new Date();
  if (workshop.registrationClosesAt && workshop.registrationClosesAt < now) {
    return Response.json({ error: "Registration has already closed" }, { status: 422 });
  }

  const [deleted] = await db
    .delete(workshopRegistrations)
    .where(
      and(
        eq(workshopRegistrations.workshopId, workshopId),
        eq(workshopRegistrations.userId, user.sub)
      )
    )
    .returning({ id: workshopRegistrations.id });

  if (!deleted) return Response.json({ error: "Registration not found" }, { status: 404 });

  return Response.json({ success: true });
});

// Admin: list workshops for a project
const getAdminProjectWorkshops = withRole<{ id: string }>(Role.ADMIN, async (req) => {
  const { id } = req.params;

  const rows = await db
    .select()
    .from(workshops)
    .where(eq(workshops.projectId, id))
    .orderBy(workshops.startingAt);

  const result = await buildWorkshopResponse(rows);
  return Response.json(result);
});

// Admin: create workshop
const createWorkshop = withRole<{ id: string }>(Role.ADMIN, async (req, user) => {
  const { id } = req.params;

  const [project] = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

  const { startingAt, endingAt, registrationOpensAt, registrationClosesAt, description, ...rest } =
    await parseBody(req, workshopSchema);

  const [workshop] = await db
    .insert(workshops)
    .values({
      projectId: id,
      ...rest,
      description: description || null,
      startingAt: new Date(startingAt),
      endingAt: endingAt ? new Date(endingAt) : null,
      registrationOpensAt: registrationOpensAt ? new Date(registrationOpensAt) : null,
      registrationClosesAt: registrationClosesAt ? new Date(registrationClosesAt) : null,
    })
    .returning();

  if (workshop) {
    await recordAudit(user, {
      action: AuditAction.CREATE,
      entityType: AuditEntityType.WORKSHOP,
      entityId: workshop.id,
      entityLabel: workshop.title,
      changes: createdChanges({ ...workshop, projectId: undefined }),
      metadata: { projectId: id, projectTitle: project.title },
    });
  }

  return Response.json(workshop, { status: 201 });
});

// Admin: update workshop
const updateWorkshop = withRole<{ workshopId: string }>(Role.ADMIN, async (req, user) => {
  const { workshopId } = req.params;
  const { startingAt, endingAt, registrationOpensAt, registrationClosesAt, description, ...rest } =
    await parseBody(req, updateWorkshopSchema);

  const [before] = await db.select().from(workshops).where(eq(workshops.id, workshopId)).limit(1);

  const [updated] = await db
    .update(workshops)
    .set({
      ...rest,
      ...(description !== undefined && { description: description || null }),
      ...(startingAt !== undefined && { startingAt: new Date(startingAt) }),
      ...(endingAt !== undefined && { endingAt: endingAt ? new Date(endingAt) : null }),
      ...(registrationOpensAt !== undefined && {
        registrationOpensAt: registrationOpensAt ? new Date(registrationOpensAt) : null,
      }),
      ...(registrationClosesAt !== undefined && {
        registrationClosesAt: registrationClosesAt ? new Date(registrationClosesAt) : null,
      }),
      updatedAt: new Date(),
    })
    .where(eq(workshops.id, workshopId))
    .returning();

  if (!updated) return Response.json({ error: "Workshop not found" }, { status: 404 });

  const changes = diffChanges(before ?? {}, updated);
  if (changes) {
    await recordAudit(user, {
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.WORKSHOP,
      entityId: updated.id,
      entityLabel: updated.title,
      changes,
      metadata: {
        projectId: updated.projectId,
        projectTitle: (await lookupProjectTitle(updated.projectId)) ?? null,
      },
    });
  }

  return Response.json(updated);
});

// Admin: delete workshop (cascade deletes registrations via FK)
const deleteWorkshop = withRole<{ workshopId: string }>(Role.ADMIN, async (req, user) => {
  const { workshopId } = req.params;

  const [deleted] = await db.delete(workshops).where(eq(workshops.id, workshopId)).returning();

  if (!deleted) return Response.json({ error: "Workshop not found" }, { status: 404 });

  await recordAudit(user, {
    action: AuditAction.DELETE,
    entityType: AuditEntityType.WORKSHOP,
    entityId: deleted.id,
    entityLabel: deleted.title,
    changes: deletedChanges({ ...deleted, projectId: undefined }),
    metadata: {
      projectId: deleted.projectId,
      projectTitle: (await lookupProjectTitle(deleted.projectId)) ?? null,
    },
  });
  return Response.json({ success: true });
});

// Admin: list registrations for a workshop
const getWorkshopRegistrations = withRole<{ workshopId: string }>(Role.ADMIN, async (req) => {
  const { workshopId } = req.params;

  const rows = await db
    .select({
      id: workshopRegistrations.id,
      workshopId: workshopRegistrations.workshopId,
      userId: workshopRegistrations.userId,
      userName: users.name,
      userEmail: users.email,
      attended: workshopRegistrations.attended,
      createdAt: workshopRegistrations.createdAt,
    })
    .from(workshopRegistrations)
    .innerJoin(users, eq(workshopRegistrations.userId, users.id))
    .where(eq(workshopRegistrations.workshopId, workshopId))
    .orderBy(workshopRegistrations.createdAt);

  return Response.json(rows);
});

// Admin: add participant to a workshop (SUPER_ADMIN)
const addWorkshopRegistration = withRole<{ workshopId: string }>(
  Role.SUPER_ADMIN,
  async (req, user) => {
    const { workshopId } = req.params;
    const body = await parseBody(req, z.object({ userId: z.uuid() }));

    const [workshop] = await db
      .select({ id: workshops.id, title: workshops.title, projectId: workshops.projectId })
      .from(workshops)
      .where(eq(workshops.id, workshopId))
      .limit(1);

    if (!workshop) return Response.json({ error: "Workshop not found" }, { status: 404 });

    const [projectReg] = await db
      .select({ id: projectRegistrations.id })
      .from(projectRegistrations)
      .where(
        and(
          eq(projectRegistrations.projectId, workshop.projectId),
          eq(projectRegistrations.userId, body.userId)
        )
      )
      .limit(1);

    if (!projectReg) {
      return Response.json({ error: "User is not registered for this project" }, { status: 422 });
    }

    const [existing] = await db
      .select({ id: workshopRegistrations.id })
      .from(workshopRegistrations)
      .where(
        and(
          eq(workshopRegistrations.workshopId, workshopId),
          eq(workshopRegistrations.userId, body.userId)
        )
      )
      .limit(1);

    if (existing) return Response.json({ error: "User already registered" }, { status: 409 });

    const [registration] = await db
      .insert(workshopRegistrations)
      .values({ workshopId, userId: body.userId })
      .returning();

    if (registration) {
      await recordAudit(user, {
        action: AuditAction.CREATE,
        entityType: AuditEntityType.REGISTRATION,
        entityId: registration.id,
        entityLabel: (await lookupUserName(body.userId)) ?? body.userId,
        metadata: { ...(await workshopMetadata(workshop)), userId: body.userId },
      });
    }

    return Response.json(registration, { status: 201 });
  }
);

// Admin: remove a workshop registration (SUPER_ADMIN)
const deleteWorkshopRegistration = withRole<{ workshopId: string; userId: string }>(
  Role.SUPER_ADMIN,
  async (req, user) => {
    const { workshopId, userId } = req.params;

    const [deleted] = await db
      .delete(workshopRegistrations)
      .where(
        and(
          eq(workshopRegistrations.workshopId, workshopId),
          eq(workshopRegistrations.userId, userId)
        )
      )
      .returning({ id: workshopRegistrations.id });

    if (!deleted) return Response.json({ error: "Registration not found" }, { status: 404 });

    const [workshop] = await db
      .select({ id: workshops.id, title: workshops.title, projectId: workshops.projectId })
      .from(workshops)
      .where(eq(workshops.id, workshopId))
      .limit(1);

    await recordAudit(user, {
      action: AuditAction.DELETE,
      entityType: AuditEntityType.REGISTRATION,
      entityId: deleted.id,
      entityLabel: (await lookupUserName(userId)) ?? userId,
      metadata: { ...(workshop ? await workshopMetadata(workshop) : { workshopId }), userId },
    });

    return Response.json({ success: true });
  }
);

// Admin: toggle attended for a workshop registration
const toggleWorkshopAttended = withRole<{ workshopId: string; userId: string }>(
  Role.ADMIN,
  async (req) => {
    const { workshopId, userId } = req.params;
    const body = await parseBody(req, z.object({ attended: z.boolean() }));

    const [updated] = await db
      .update(workshopRegistrations)
      .set({ attended: body.attended })
      .where(
        and(
          eq(workshopRegistrations.workshopId, workshopId),
          eq(workshopRegistrations.userId, userId)
        )
      )
      .returning();

    if (!updated) return Response.json({ error: "Registration not found" }, { status: 404 });
    return Response.json(updated);
  }
);

export const workshopRoutes = {
  [ApiRoutes.PROJECT_WORKSHOPS]: { GET: getProjectWorkshops },
  [ApiRoutes.WORKSHOP_MY_REGISTRATION]: { GET: getMyWorkshopRegistration },
  [ApiRoutes.WORKSHOP_REGISTER]: {
    POST: registerForWorkshop,
    DELETE: unregisterFromWorkshop,
  },
  [ApiRoutes.ADMIN_PROJECT_WORKSHOPS]: {
    GET: getAdminProjectWorkshops,
    POST: createWorkshop,
  },
  [ApiRoutes.ADMIN_WORKSHOP_BY_ID]: {
    PATCH: updateWorkshop,
    DELETE: deleteWorkshop,
  },
  [ApiRoutes.ADMIN_WORKSHOP_REGISTRATIONS]: {
    GET: getWorkshopRegistrations,
    POST: addWorkshopRegistration,
  },
  [ApiRoutes.ADMIN_WORKSHOP_REGISTRATION_BY_ID]: {
    DELETE: deleteWorkshopRegistration,
  },
  [ApiRoutes.ADMIN_WORKSHOP_REGISTRATION_ATTENDED]: {
    PATCH: toggleWorkshopAttended,
  },
};
