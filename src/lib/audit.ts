import { eq } from "drizzle-orm";

import type { AuditAction, AuditEntityType } from "@/constants/enums";
import type { AuditChanges, AuditMetadata, AuditValue } from "@/constants/types";
import { auditLogs, pillars, projects, users } from "@/db/schema";
import { db } from "@/lib/db";
import type { JwtUser } from "@/lib/jwt";
import { stripHtml } from "@/lib/utils";

const IGNORED_FIELDS = new Set(["id", "createdAt", "updatedAt", "uploadedAt"]);
const REDACTED_FIELDS = new Set(["passwordHash", "tokenHash", "googleId"]);
const RICH_TEXT_FIELDS = new Set(["description", "aboutUs"]);
const MAX_VALUE_LENGTH = 300;

type AuditRow = Record<string, unknown>;

interface AuditEntry {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | number | null;
  entityLabel: string;
  changes?: AuditChanges | null;
  metadata?: AuditMetadata | null;
}

function truncate(value: string): string {
  return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
}

function toAuditValue(key: string, value: unknown): AuditValue {
  if (value === undefined || value === null) return null;
  if (REDACTED_FIELDS.has(key)) return "[redacted]";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return truncate(RICH_TEXT_FIELDS.has(key) ? stripHtml(value) : value);
  }
  return truncate(JSON.stringify(value));
}

function isPlainObject(value: unknown): value is AuditRow {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

function flatten(row: AuditRow, prefix = ""): Record<string, AuditValue> {
  const result: Record<string, AuditValue> = {};
  for (const [key, value] of Object.entries(row)) {
    if (IGNORED_FIELDS.has(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      Object.assign(result, flatten(value, path));
    } else {
      result[path] = toAuditValue(key, value);
    }
  }
  return result;
}

export function diffChanges(before: AuditRow, after: AuditRow): AuditChanges | null {
  const from = flatten(before);
  const to = flatten(after);
  const changes: AuditChanges = {};
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const prev = from[key] ?? null;
    const next = to[key] ?? null;
    if (prev !== next) changes[key] = { from: prev, to: next };
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

export function createdChanges(row: AuditRow): AuditChanges | null {
  return diffChanges({}, row);
}

export function deletedChanges(row: AuditRow): AuditChanges | null {
  return diffChanges(row, {});
}

export async function relabelReference(
  changes: AuditChanges | null,
  field: string,
  label: string,
  lookup: (id: string) => Promise<string | undefined>
): Promise<AuditChanges | null> {
  const change = changes?.[field];
  if (!changes || !change) return changes;
  const resolve = async (value: AuditValue) =>
    typeof value === "string" ? ((await lookup(value)) ?? value) : value;
  const { [field]: _, ...rest } = changes;
  return { ...rest, [label]: { from: await resolve(change.from), to: await resolve(change.to) } };
}

export async function lookupUserName(id: string): Promise<string | undefined> {
  const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, id)).limit(1);
  return row?.name;
}

export async function lookupPillarName(id: string): Promise<string | undefined> {
  const [row] = await db
    .select({ name: pillars.name })
    .from(pillars)
    .where(eq(pillars.id, id))
    .limit(1);
  return row?.name;
}

export async function lookupProjectTitle(id: string): Promise<string | undefined> {
  const [row] = await db
    .select({ title: projects.title })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  return row?.title;
}

export async function recordAudit(actor: JwtUser, entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorId: actor.sub,
      actorName: actor.name,
      actorEmail: actor.email,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId == null ? null : String(entry.entityId),
      entityLabel: truncate(entry.entityLabel),
      changes: entry.changes ?? null,
      metadata: entry.metadata ?? null,
    });
  } catch (err) {
    console.error("Failed to record audit log", err);
  }
}
