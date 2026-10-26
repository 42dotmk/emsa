import { eq, inArray } from "drizzle-orm";

import { AuditAction, AuditEntityType, Role } from "@/constants/enums";
import { ApiRoutes } from "@/constants/routes";
import { pillarSchema, updatePillarSchema } from "@/constants/schemas";
import { pillars, projectImages, projects, users } from "@/db/schema";
import {
  createdChanges,
  deletedChanges,
  diffChanges,
  lookupUserName,
  recordAudit,
  relabelReference,
} from "@/lib/audit";
import { db } from "@/lib/db";
import { type BunRequest, parseBody, withRole } from "@/lib/middleware";
import { deleteObject, getPresignedUploadUrl, validateImageContentType } from "@/lib/s3";

// Public
const getPillars = async () => {
  const rows = await db
    .select({
      id: pillars.id,
      name: pillars.name,
      description: pillars.description,
      imageUrl: pillars.imageUrl,
      directorName: users.name,
      directorImageUrl: users.imageUrl,
    })
    .from(pillars)
    .leftJoin(users, eq(pillars.directorId, users.id))
    .orderBy(pillars.createdAt);

  return Response.json(rows);
};

const getPillarById = async (req: BunRequest<{ id: string }>) => {
  const { id } = req.params;

  const [pillar] = await db
    .select({
      id: pillars.id,
      name: pillars.name,
      description: pillars.description,
      imageUrl: pillars.imageUrl,
      directorName: users.name,
      directorImageUrl: users.imageUrl,
    })
    .from(pillars)
    .leftJoin(users, eq(pillars.directorId, users.id))
    .where(eq(pillars.id, id))
    .limit(1);

  if (!pillar) return Response.json({ error: "Not found" }, { status: 404 });

  const pillarProjects = await db
    .select({
      id: projects.id,
      title: projects.title,
      description: projects.description,
      startingAt: projects.startingAt,
      pillarId: projects.pillarId,
    })
    .from(projects)
    .where(eq(projects.pillarId, id))
    .orderBy(projects.startingAt);

  if (pillarProjects.length === 0) {
    return Response.json({ ...pillar, projects: [] });
  }

  const allImages = await db
    .select({ projectId: projectImages.projectId, url: projectImages.url })
    .from(projectImages)
    .where(
      inArray(
        projectImages.projectId,
        pillarProjects.map((p) => p.id)
      )
    )
    .orderBy(projectImages.order);

  const imagesByProject = allImages.reduce<Record<string, string[]>>((acc, img) => {
    (acc[img.projectId] ??= []).push(img.url);
    return acc;
  }, {});

  return Response.json({
    ...pillar,
    projects: pillarProjects.map((p) => ({
      ...p,
      pillarName: pillar.name,
      images: imagesByProject[p.id] ?? [],
    })),
  });
};

// Admin
const getPillarsAdmin = withRole(Role.SUPER_ADMIN, async () => {
  const rows = await db
    .select({
      id: pillars.id,
      name: pillars.name,
      description: pillars.description,
      imageUrl: pillars.imageUrl,
      directorId: pillars.directorId,
      directorName: users.name,
      createdAt: pillars.createdAt,
      updatedAt: pillars.updatedAt,
    })
    .from(pillars)
    .leftJoin(users, eq(pillars.directorId, users.id))
    .orderBy(pillars.createdAt);

  return Response.json(rows);
});

const createPillar = withRole(Role.SUPER_ADMIN, async (req, user) => {
  const data = await parseBody(req, pillarSchema);

  const [pillar] = await db.insert(pillars).values(data).returning();
  if (!pillar) {
    return Response.json({ error: "Failed to create" }, { status: 500 });
  }

  await recordAudit(user, {
    action: AuditAction.CREATE,
    entityType: AuditEntityType.PILLAR,
    entityId: pillar.id,
    entityLabel: pillar.name,
    changes: await relabelReference(
      createdChanges(pillar),
      "directorId",
      "director",
      lookupUserName
    ),
  });

  return Response.json(pillar, { status: 201 });
});

const updatePillar = withRole<{ id: string }>(Role.SUPER_ADMIN, async (req, user) => {
  const { id } = req.params;
  const data = await parseBody(req, updatePillarSchema);

  const [existing] = await db.select().from(pillars).where(eq(pillars.id, id)).limit(1);

  const [updated] = await db
    .update(pillars)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(pillars.id, id))
    .returning();

  if (!updated) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (existing?.imageUrl && data.imageUrl !== undefined && data.imageUrl !== existing.imageUrl) {
    deleteObject(existing.imageUrl).catch(console.error);
  }

  const changes = diffChanges(existing ?? {}, updated);
  if (changes) {
    await recordAudit(user, {
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.PILLAR,
      entityId: updated.id,
      entityLabel: updated.name,
      changes: await relabelReference(changes, "directorId", "director", lookupUserName),
    });
  }

  return Response.json(updated);
});

const deletePillar = withRole<{ id: string }>(Role.SUPER_ADMIN, async (req, user) => {
  const { id } = req.params;

  const [deleted] = await db.delete(pillars).where(eq(pillars.id, id)).returning();

  if (!deleted) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await recordAudit(user, {
    action: AuditAction.DELETE,
    entityType: AuditEntityType.PILLAR,
    entityId: deleted.id,
    entityLabel: deleted.name,
    changes: await relabelReference(
      deletedChanges(deleted),
      "directorId",
      "director",
      lookupUserName
    ),
  });

  return Response.json({ success: true });
});

const getPillarUploadUrl = withRole(Role.SUPER_ADMIN, async (req) => {
  const contentType = new URL(req.url).searchParams.get("contentType") ?? "image/jpeg";
  const ext = validateImageContentType(contentType);
  const key = `pillar/${crypto.randomUUID()}.${ext}`;
  const { uploadUrl, fileUrl } = await getPresignedUploadUrl(key, contentType);
  return Response.json({ uploadUrl, fileUrl, key });
});

export const pillarRoutes = {
  [ApiRoutes.PILLARS]: { GET: getPillars },
  [ApiRoutes.PILLAR_BY_ID]: { GET: getPillarById },
  [ApiRoutes.ADMIN_PILLARS]: { GET: getPillarsAdmin, POST: createPillar },
  [ApiRoutes.ADMIN_PILLAR_BY_ID]: { PATCH: updatePillar, DELETE: deletePillar },
  [ApiRoutes.ADMIN_PILLARS_UPLOAD]: { GET: getPillarUploadUrl },
};
