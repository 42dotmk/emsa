import { asc, desc, eq } from "drizzle-orm";

import { AuditAction, AuditEntityType, Role } from "@/constants/enums";
import { ApiRoutes } from "@/constants/routes";
import { positionReorderSchema, positionSchema } from "@/constants/schemas";
import { positions, users } from "@/db/schema";
import {
  createdChanges,
  deletedChanges,
  diffChanges,
  lookupUserName,
  recordAudit,
  relabelReference,
} from "@/lib/audit";
import { db } from "@/lib/db";
import { parseBody, withRole } from "@/lib/middleware";

const positionColumns = {
  id: positions.id,
  title: positions.title,
  userId: positions.userId,
  order: positions.order,
  createdAt: positions.createdAt,
};

const listPositions = async () => {
  const rows = await db
    .select({
      id: positions.id,
      title: positions.title,
      userId: positions.userId,
      userName: users.name,
      userImageUrl: users.imageUrl,
      order: positions.order,
      createdAt: positions.createdAt,
    })
    .from(positions)
    .innerJoin(users, eq(positions.userId, users.id))
    .orderBy(asc(positions.order));

  return Response.json(rows);
};

const createPosition = withRole(Role.SUPER_ADMIN, async (req, user) => {
  const data = await parseBody(req, positionSchema);

  const [last] = await db
    .select({ order: positions.order })
    .from(positions)
    .orderBy(desc(positions.order))
    .limit(1);
  const nextOrder = last ? last.order + 1 : 0;

  const [created] = await db
    .insert(positions)
    .values({ ...data, order: nextOrder })
    .returning(positionColumns);

  if (!created) {
    return Response.json({ error: "Failed to create position" }, { status: 500 });
  }

  const [holder] = await db
    .select({ name: users.name, imageUrl: users.imageUrl })
    .from(users)
    .where(eq(users.id, created.userId))
    .limit(1);

  await recordAudit(user, {
    action: AuditAction.CREATE,
    entityType: AuditEntityType.POSITION,
    entityId: created.id,
    entityLabel: created.title,
    changes: await relabelReference(createdChanges(created), "userId", "holder", lookupUserName),
  });

  return Response.json(
    { ...created, userName: holder?.name ?? null, userImageUrl: holder?.imageUrl ?? null },
    { status: 201 }
  );
});

const updatePosition = withRole<{ id: string }>(Role.SUPER_ADMIN, async (req, user) => {
  const { id } = req.params;
  const data = await parseBody(req, positionSchema);

  const [existing] = await db
    .select(positionColumns)
    .from(positions)
    .where(eq(positions.id, id))
    .limit(1);

  const [updated] = await db
    .update(positions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(positions.id, id))
    .returning(positionColumns);

  if (!updated) {
    return Response.json({ error: "Position not found" }, { status: 404 });
  }

  const [holder] = await db
    .select({ name: users.name, imageUrl: users.imageUrl })
    .from(users)
    .where(eq(users.id, updated.userId))
    .limit(1);

  const changes = diffChanges(existing ?? {}, updated);
  if (changes) {
    await recordAudit(user, {
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.POSITION,
      entityId: updated.id,
      entityLabel: updated.title,
      changes: await relabelReference(changes, "userId", "holder", lookupUserName),
    });
  }

  return Response.json({
    ...updated,
    userName: holder?.name ?? null,
    userImageUrl: holder?.imageUrl ?? null,
  });
});

const deletePosition = withRole<{ id: string }>(Role.SUPER_ADMIN, async (req, user) => {
  const { id } = req.params;

  const [deleted] = await db
    .delete(positions)
    .where(eq(positions.id, id))
    .returning(positionColumns);

  if (!deleted) {
    return Response.json({ error: "Position not found" }, { status: 404 });
  }

  await recordAudit(user, {
    action: AuditAction.DELETE,
    entityType: AuditEntityType.POSITION,
    entityId: deleted.id,
    entityLabel: deleted.title,
    changes: await relabelReference(deletedChanges(deleted), "userId", "holder", lookupUserName),
  });

  return Response.json({ id: deleted.id });
});

const reorderPositions = withRole(Role.SUPER_ADMIN, async (req, user) => {
  const { ids } = await parseBody(req, positionReorderSchema);

  await db.transaction(async (tx) => {
    await Promise.all(
      ids.map((id, index) =>
        tx
          .update(positions)
          .set({ order: index, updatedAt: new Date() })
          .where(eq(positions.id, id))
      )
    );
  });

  await recordAudit(user, {
    action: AuditAction.REORDER,
    entityType: AuditEntityType.POSITION,
    entityLabel: "Board positions",
    metadata: { count: ids.length },
  });

  return Response.json({ success: true });
});

export const positionRoutes = {
  [ApiRoutes.POSITIONS]: { GET: listPositions },
  [ApiRoutes.ADMIN_POSITIONS_REORDER]: { PATCH: reorderPositions },
  [ApiRoutes.ADMIN_POSITIONS]: { POST: createPosition },
  [ApiRoutes.ADMIN_POSITION_BY_ID]: { PATCH: updatePosition, DELETE: deletePosition },
};
