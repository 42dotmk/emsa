import { asc, desc, eq } from "drizzle-orm";

import { AuditAction, AuditEntityType, Role } from "@/constants/enums";
import { ApiRoutes } from "@/constants/routes";
import { supporterReorderSchema, supporterSchema } from "@/constants/schemas";
import { supporters } from "@/db/schema";
import { createdChanges, deletedChanges, diffChanges, recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { parseBody, withRole } from "@/lib/middleware";
import { deleteObject, getPresignedUploadUrl, validateImageContentType } from "@/lib/s3";

const supporterColumns = {
  id: supporters.id,
  name: supporters.name,
  logoUrl: supporters.logoUrl,
  websiteUrl: supporters.websiteUrl,
  order: supporters.order,
  createdAt: supporters.createdAt,
};

const listSupporters = async () => {
  const rows = await db.select(supporterColumns).from(supporters).orderBy(asc(supporters.order));

  return Response.json(rows);
};

const createSupporter = withRole(Role.SUPER_ADMIN, async (req, user) => {
  const data = await parseBody(req, supporterSchema);

  const [last] = await db
    .select({ order: supporters.order })
    .from(supporters)
    .orderBy(desc(supporters.order))
    .limit(1);
  const nextOrder = last ? last.order + 1 : 0;

  const [created] = await db
    .insert(supporters)
    .values({ ...data, order: nextOrder })
    .returning(supporterColumns);

  if (!created) {
    return Response.json({ error: "Failed to create supporter" }, { status: 500 });
  }

  await recordAudit(user, {
    action: AuditAction.CREATE,
    entityType: AuditEntityType.SUPPORTER,
    entityId: created.id,
    entityLabel: created.name,
    changes: createdChanges(created),
  });

  return Response.json(created, { status: 201 });
});

const updateSupporter = withRole<{ id: string }>(Role.SUPER_ADMIN, async (req, user) => {
  const { id } = req.params;
  const data = await parseBody(req, supporterSchema);

  const [existing] = await db
    .select(supporterColumns)
    .from(supporters)
    .where(eq(supporters.id, id))
    .limit(1);

  const [updated] = await db
    .update(supporters)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(supporters.id, id))
    .returning(supporterColumns);

  if (!updated) {
    return Response.json({ error: "Supporter not found" }, { status: 404 });
  }

  if (existing && existing.logoUrl !== updated.logoUrl) {
    deleteObject(existing.logoUrl).catch(console.error);
  }

  const changes = diffChanges(existing ?? {}, updated);
  if (changes) {
    await recordAudit(user, {
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.SUPPORTER,
      entityId: updated.id,
      entityLabel: updated.name,
      changes,
    });
  }

  return Response.json(updated);
});

const deleteSupporter = withRole<{ id: string }>(Role.SUPER_ADMIN, async (req, user) => {
  const { id } = req.params;

  const [deleted] = await db
    .delete(supporters)
    .where(eq(supporters.id, id))
    .returning(supporterColumns);

  if (!deleted) {
    return Response.json({ error: "Supporter not found" }, { status: 404 });
  }

  await recordAudit(user, {
    action: AuditAction.DELETE,
    entityType: AuditEntityType.SUPPORTER,
    entityId: deleted.id,
    entityLabel: deleted.name,
    changes: deletedChanges(deleted),
  });

  deleteObject(deleted.logoUrl).catch(console.error);

  return Response.json({ id: deleted.id });
});

const reorderSupporters = withRole(Role.SUPER_ADMIN, async (req, user) => {
  const { ids } = await parseBody(req, supporterReorderSchema);

  await db.transaction(async (tx) => {
    await Promise.all(
      ids.map((id, index) =>
        tx
          .update(supporters)
          .set({ order: index, updatedAt: new Date() })
          .where(eq(supporters.id, id))
      )
    );
  });

  await recordAudit(user, {
    action: AuditAction.REORDER,
    entityType: AuditEntityType.SUPPORTER,
    entityLabel: "Supporters",
    metadata: { count: ids.length },
  });

  return Response.json({ success: true });
});

const getSupporterUploadUrl = withRole(Role.SUPER_ADMIN, async (req) => {
  const contentType = new URL(req.url).searchParams.get("contentType") ?? "image/jpeg";
  const ext = validateImageContentType(contentType);
  const key = `supporters/${crypto.randomUUID()}.${ext}`;
  const { uploadUrl, fileUrl } = await getPresignedUploadUrl(key, contentType);

  return Response.json({ uploadUrl, fileUrl, key });
});

export const supporterRoutes = {
  [ApiRoutes.SUPPORTERS]: { GET: listSupporters },
  [ApiRoutes.ADMIN_SUPPORTERS_REORDER]: { PATCH: reorderSupporters },
  [ApiRoutes.ADMIN_SUPPORTERS_UPLOAD]: { GET: getSupporterUploadUrl },
  [ApiRoutes.ADMIN_SUPPORTERS]: { POST: createSupporter },
  [ApiRoutes.ADMIN_SUPPORTER_BY_ID]: { PATCH: updateSupporter, DELETE: deleteSupporter },
};
