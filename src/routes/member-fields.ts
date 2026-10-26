import { asc, desc, eq, sql } from "drizzle-orm";

import { AuditAction, AuditEntityType, Role } from "@/constants/enums";
import { ApiRoutes } from "@/constants/routes";
import {
  memberFieldReorderSchema,
  memberFieldSchema,
  updateMemberFieldSchema,
} from "@/constants/schemas";
import { memberFieldDefinitions, users } from "@/db/schema";
import { createdChanges, deletedChanges, diffChanges, recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { parseBody, withRole } from "@/lib/middleware";

const memberFieldColumns = {
  id: memberFieldDefinitions.id,
  key: memberFieldDefinitions.key,
  label: memberFieldDefinitions.label,
  type: memberFieldDefinitions.type,
  required: memberFieldDefinitions.required,
  suggestions: memberFieldDefinitions.suggestions,
  order: memberFieldDefinitions.order,
  createdAt: memberFieldDefinitions.createdAt,
};

const recomputeProfileCompleted = sql`
  UPDATE users u SET profile_completed = coalesce((
    SELECT bool_and(nullif(btrim(u.custom_fields->>d.key), '') IS NOT NULL)
    FROM member_field_definitions d WHERE d.required
  ), true)`;

// Public
const listMemberFields = async () => {
  const rows = await db
    .select(memberFieldColumns)
    .from(memberFieldDefinitions)
    .orderBy(asc(memberFieldDefinitions.order));
  return Response.json(rows);
};

const getFieldSuggestions = async (req: Request & { params: { key: string } }) => {
  const { key } = req.params;

  const [def] = await db
    .select({ suggestions: memberFieldDefinitions.suggestions })
    .from(memberFieldDefinitions)
    .where(eq(memberFieldDefinitions.key, key))
    .limit(1);

  if (!def?.suggestions) {
    return Response.json({ error: "Field not found" }, { status: 404 });
  }

  const rows = await db
    .selectDistinct({ value: sql<string>`${users.customFields}->>${key}` })
    .from(users)
    .where(sql`nullif(btrim(${users.customFields}->>${key}), '') IS NOT NULL`);

  return Response.json(rows.map((r) => r.value).sort((a, b) => a.localeCompare(b)));
};

// Admin
const createMemberField = withRole(Role.SUPER_ADMIN, async (req, user) => {
  const data = await parseBody(req, memberFieldSchema);

  const [last] = await db
    .select({ order: memberFieldDefinitions.order })
    .from(memberFieldDefinitions)
    .orderBy(desc(memberFieldDefinitions.order))
    .limit(1);
  const nextOrder = last ? last.order + 1 : 0;

  try {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(memberFieldDefinitions)
        .values({ ...data, order: nextOrder })
        .returning(memberFieldColumns);
      if (data.required) {
        await tx.execute(recomputeProfileCompleted);
      }
      return row;
    });

    if (created) {
      await recordAudit(user, {
        action: AuditAction.CREATE,
        entityType: AuditEntityType.MEMBER_FIELD,
        entityId: created.id,
        entityLabel: created.label,
        changes: createdChanges(created),
      });
    }

    return Response.json(created, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return Response.json({ error: "Field key already exists" }, { status: 409 });
    }
    throw err;
  }
});

const updateMemberField = withRole<{ id: string }>(Role.SUPER_ADMIN, async (req, user) => {
  const { id } = req.params;
  const data = await parseBody(req, updateMemberFieldSchema);

  const [existing] = await db
    .select(memberFieldColumns)
    .from(memberFieldDefinitions)
    .where(eq(memberFieldDefinitions.id, id))
    .limit(1);

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(memberFieldDefinitions)
      .set({
        ...(data.label !== undefined && { label: data.label }),
        ...(data.required !== undefined && { required: data.required }),
        ...(data.suggestions !== undefined && { suggestions: data.suggestions }),
        updatedAt: new Date(),
      })
      .where(eq(memberFieldDefinitions.id, id))
      .returning(memberFieldColumns);
    if (row && data.required !== undefined) {
      await tx.execute(recomputeProfileCompleted);
    }
    return row;
  });

  if (!updated) {
    return Response.json({ error: "Field not found" }, { status: 404 });
  }

  const changes = diffChanges(existing ?? {}, updated);
  if (changes) {
    await recordAudit(user, {
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.MEMBER_FIELD,
      entityId: updated.id,
      entityLabel: updated.label,
      changes,
    });
  }

  return Response.json(updated);
});

const deleteMemberField = withRole<{ id: string }>(Role.SUPER_ADMIN, async (req, user) => {
  const { id } = req.params;

  const deleted = await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(memberFieldDefinitions)
      .where(eq(memberFieldDefinitions.id, id))
      .returning(memberFieldColumns);
    if (row) {
      await tx.execute(
        sql`UPDATE ${users} SET custom_fields = custom_fields - ${row.key}, updated_at = now()`
      );
      await tx.execute(recomputeProfileCompleted);
    }
    return row;
  });

  if (!deleted) {
    return Response.json({ error: "Field not found" }, { status: 404 });
  }

  await recordAudit(user, {
    action: AuditAction.DELETE,
    entityType: AuditEntityType.MEMBER_FIELD,
    entityId: deleted.id,
    entityLabel: deleted.label,
    changes: deletedChanges(deleted),
  });

  return Response.json({ id: deleted.id });
});

const reorderMemberFields = withRole(Role.SUPER_ADMIN, async (req, user) => {
  const { ids } = await parseBody(req, memberFieldReorderSchema);

  await db.transaction(async (tx) => {
    await Promise.all(
      ids.map((id, index) =>
        tx
          .update(memberFieldDefinitions)
          .set({ order: index, updatedAt: new Date() })
          .where(eq(memberFieldDefinitions.id, id))
      )
    );
  });

  await recordAudit(user, {
    action: AuditAction.REORDER,
    entityType: AuditEntityType.MEMBER_FIELD,
    entityLabel: "Member fields",
    metadata: { count: ids.length },
  });

  return Response.json({ success: true });
});

export const memberFieldRoutes = {
  [ApiRoutes.MEMBER_FIELDS]: { GET: listMemberFields },
  [ApiRoutes.MEMBER_FIELD_SUGGESTIONS]: { GET: getFieldSuggestions },
  [ApiRoutes.ADMIN_MEMBER_FIELDS_REORDER]: { PATCH: reorderMemberFields },
  [ApiRoutes.ADMIN_MEMBER_FIELDS]: { POST: createMemberField },
  [ApiRoutes.ADMIN_MEMBER_FIELD_BY_ID]: { PATCH: updateMemberField, DELETE: deleteMemberField },
};
