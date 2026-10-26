import { and, count, desc, eq, gte, ilike, isNotNull, lte, or, type SQL } from "drizzle-orm";

import { Role } from "@/constants/enums";
import { ApiRoutes } from "@/constants/routes";
import { auditLogQuerySchema } from "@/constants/schemas";
import { auditLogs, users } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError, withRole } from "@/lib/middleware";

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const listAuditLogs = withRole(Role.SUPER_ADMIN, async (req) => {
  const params = Object.fromEntries(
    [...new URL(req.url).searchParams].filter(([, value]) => value !== "")
  );
  const result = auditLogQuerySchema.safeParse(params);
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0]?.message ?? "Invalid query");
  }
  const { page, pageSize, entityType, action, actorId, entityId, from, to, q } = result.data;

  const conditions: SQL[] = [];
  if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
  if (action) conditions.push(eq(auditLogs.action, action));
  if (actorId) conditions.push(eq(auditLogs.actorId, actorId));
  if (entityId) conditions.push(eq(auditLogs.entityId, entityId));
  if (from) conditions.push(gte(auditLogs.createdAt, new Date(from)));
  if (to) conditions.push(lte(auditLogs.createdAt, new Date(to)));
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    const search = or(ilike(auditLogs.entityLabel, pattern), ilike(auditLogs.actorName, pattern));
    if (search) conditions.push(search);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, [totalRow]] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        actorId: auditLogs.actorId,
        actorName: auditLogs.actorName,
        actorEmail: auditLogs.actorEmail,
        actorImageUrl: users.imageUrl,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        entityLabel: auditLogs.entityLabel,
        changes: auditLogs.changes,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorId, users.id))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(auditLogs).where(where),
  ]);

  return Response.json({ items, total: totalRow?.total ?? 0 });
});

const listAuditLogActors = withRole(Role.SUPER_ADMIN, async () => {
  const rows = await db
    .selectDistinct({ id: auditLogs.actorId, name: auditLogs.actorName })
    .from(auditLogs)
    .where(isNotNull(auditLogs.actorId))
    .orderBy(auditLogs.actorName);

  const byId = new Map(rows.map((row) => [row.id, row]));
  return Response.json([...byId.values()]);
});

export const auditLogRoutes = {
  [ApiRoutes.ADMIN_AUDIT_LOG_ACTORS]: { GET: listAuditLogActors },
  [ApiRoutes.ADMIN_AUDIT_LOGS]: { GET: listAuditLogs },
};
