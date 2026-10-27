import { and, desc, eq, exists, gt, gte, inArray, lte, type SQL, sql } from "drizzle-orm";

import { AuditAction, AuditEntityType, PointReason } from "@/constants/enums";
import type { PointContext, PointsHistory } from "@/constants/types";
import {
  organization,
  pointTransactions,
  projectRegistrations,
  projects,
  userActivations,
  users,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { JwtUser } from "@/lib/jwt";
import { HttpError } from "@/lib/middleware";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ORG_ID = 1;
const POINTS_LOCK_KEY = 4_270_001;
const SYNC_INTERVAL_MS = 60 * 60 * 1000;
const HISTORY_LIMIT = 500;

interface PointChange {
  userId: string;
  amount: number;
  reason: PointReason;
  projectId?: string | null;
  projectTitle?: string | null;
  note?: string | null;
  context?: PointContext | null;
}

interface AppliedPointChange extends PointChange {
  userName: string;
  balanceAfter: number;
}

interface AttendanceScope {
  registrationIds?: string[];
  projectId?: string;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

async function lockPoints(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${POINTS_LOCK_KEY})`);
}

async function getPointsSettings(tx: Tx) {
  const [settings] = await tx
    .select({
      pointsEnabled: organization.pointsEnabled,
      membershipPoints: organization.membershipPoints,
    })
    .from(organization)
    .where(eq(organization.id, ORG_ID))
    .limit(1);
  return settings ?? { pointsEnabled: false, membershipPoints: 0 };
}

async function applyPointChange(
  tx: Tx,
  actor: JwtUser | null,
  change: PointChange
): Promise<AppliedPointChange> {
  const [updated] = await tx
    .update(users)
    .set({ pointsBalance: sql`${users.pointsBalance} + ${change.amount}` })
    .where(eq(users.id, change.userId))
    .returning({ name: users.name, pointsBalance: users.pointsBalance });

  if (!updated) throw new HttpError(404, "User not found");

  await tx.insert(pointTransactions).values({
    userId: change.userId,
    amount: change.amount,
    balanceAfter: updated.pointsBalance,
    reason: change.reason,
    projectId: change.projectId ?? null,
    projectTitle: change.projectTitle ?? null,
    note: change.note ?? null,
    context: change.context ?? null,
    createdById: actor?.sub ?? null,
    createdByName: actor?.name ?? null,
    createdAt: sql`clock_timestamp()`,
  });

  return { ...change, userName: updated.name, balanceAfter: updated.pointsBalance };
}

export async function recordPointChanges(
  actor: JwtUser | null,
  changes: AppliedPointChange[]
): Promise<void> {
  for (const change of changes) {
    await recordAudit(actor, {
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.POINTS,
      entityId: change.userId,
      entityLabel: change.userName,
      changes: {
        balance: { from: change.balanceAfter - change.amount, to: change.balanceAfter },
      },
      metadata: {
        userId: change.userId,
        amount: change.amount,
        reason: change.reason,
        ...(change.projectId && { projectId: change.projectId }),
        ...(change.projectTitle && { projectTitle: change.projectTitle }),
        ...(change.note && { note: change.note }),
        ...(change.context && {
          previousMembershipPoints: change.context.from,
          membershipPoints: change.context.to,
        }),
      },
    });
  }
}

async function syncMembershipPointsTx(
  tx: Tx,
  actor: JwtUser | null,
  userIds?: string[]
): Promise<AppliedPointChange[]> {
  const settings = await getPointsSettings(tx);
  if (!settings.pointsEnabled) return [];

  const today = todayStr();
  const activeNow = exists(
    tx
      .select({ id: userActivations.id })
      .from(userActivations)
      .where(
        and(
          eq(userActivations.userId, users.id),
          lte(userActivations.startDate, today),
          gte(userActivations.endDate, today)
        )
      )
  );

  const rows = await tx
    .select({
      id: users.id,
      held: users.membershipPointsHeld,
      isActive: sql<boolean>`${activeNow}`,
    })
    .from(users)
    .where(userIds ? inArray(users.id, userIds) : undefined);

  const applied: AppliedPointChange[] = [];
  for (const row of rows) {
    const target = row.isActive ? settings.membershipPoints : 0;
    if (target === row.held) continue;

    const reason = !row.isActive
      ? PointReason.MEMBERSHIP_ENDED
      : row.held === 0
        ? PointReason.MEMBERSHIP_ACTIVE
        : PointReason.MEMBERSHIP_ADJUSTED;

    applied.push(
      await applyPointChange(tx, actor, {
        userId: row.id,
        amount: target - row.held,
        reason,
        context: reason === PointReason.MEMBERSHIP_ADJUSTED ? { from: row.held, to: target } : null,
      })
    );
    await tx.update(users).set({ membershipPointsHeld: target }).where(eq(users.id, row.id));
  }
  return applied;
}

async function syncAttendancePointsTx(
  tx: Tx,
  actor: JwtUser | null,
  scope: AttendanceScope = {}
): Promise<AppliedPointChange[]> {
  const settings = await getPointsSettings(tx);
  if (!settings.pointsEnabled) return [];

  const conditions: SQL[] = [
    sql`((${projectRegistrations.attended} and ${projectRegistrations.pointsAwarded} = 0 and coalesce(${projects.points}, 0) > 0)
      or (not ${projectRegistrations.attended} and ${projectRegistrations.pointsAwarded} > 0))`,
  ];
  if (scope.registrationIds) {
    if (scope.registrationIds.length === 0) return [];
    conditions.push(inArray(projectRegistrations.id, scope.registrationIds));
  }
  if (scope.projectId) conditions.push(eq(projectRegistrations.projectId, scope.projectId));

  const rows = await tx
    .select({
      id: projectRegistrations.id,
      userId: projectRegistrations.userId,
      attended: projectRegistrations.attended,
      pointsAwarded: projectRegistrations.pointsAwarded,
      projectId: projects.id,
      projectTitle: projects.title,
      projectPoints: projects.points,
    })
    .from(projectRegistrations)
    .innerJoin(projects, eq(projectRegistrations.projectId, projects.id))
    .where(and(...conditions));

  const applied: AppliedPointChange[] = [];
  for (const row of rows) {
    const award = row.attended ? (row.projectPoints ?? 0) : 0;
    applied.push(
      await applyPointChange(tx, actor, {
        userId: row.userId,
        amount: row.attended ? award : -row.pointsAwarded,
        reason: row.attended
          ? PointReason.PROJECT_ATTENDANCE
          : PointReason.PROJECT_ATTENDANCE_REVOKED,
        projectId: row.projectId,
        projectTitle: row.projectTitle,
      })
    );
    await tx
      .update(projectRegistrations)
      .set({ pointsAwarded: award })
      .where(eq(projectRegistrations.id, row.id));
  }
  return applied;
}

export async function revokeRegistrationPointsTx(
  tx: Tx,
  actor: JwtUser | null,
  registrationIds: string[]
): Promise<AppliedPointChange[]> {
  if (registrationIds.length === 0) return [];
  await lockPoints(tx);

  const rows = await tx
    .select({
      id: projectRegistrations.id,
      userId: projectRegistrations.userId,
      pointsAwarded: projectRegistrations.pointsAwarded,
      projectId: projects.id,
      projectTitle: projects.title,
    })
    .from(projectRegistrations)
    .innerJoin(projects, eq(projectRegistrations.projectId, projects.id))
    .where(
      and(
        inArray(projectRegistrations.id, registrationIds),
        gt(projectRegistrations.pointsAwarded, 0)
      )
    );

  const applied: AppliedPointChange[] = [];
  for (const row of rows) {
    applied.push(
      await applyPointChange(tx, actor, {
        userId: row.userId,
        amount: -row.pointsAwarded,
        reason: PointReason.PROJECT_ATTENDANCE_REVOKED,
        projectId: row.projectId,
        projectTitle: row.projectTitle,
      })
    );
    await tx
      .update(projectRegistrations)
      .set({ pointsAwarded: 0 })
      .where(eq(projectRegistrations.id, row.id));
  }
  return applied;
}

export async function syncMembershipPoints(
  actor: JwtUser | null,
  userIds?: string[]
): Promise<void> {
  if (userIds?.length === 0) return;
  const changes = await db.transaction(async (tx) => {
    await lockPoints(tx);
    return syncMembershipPointsTx(tx, actor, userIds);
  });
  await recordPointChanges(actor, changes);
}

export async function syncAttendancePoints(
  actor: JwtUser | null,
  scope: AttendanceScope = {}
): Promise<void> {
  const changes = await db.transaction(async (tx) => {
    await lockPoints(tx);
    return syncAttendancePointsTx(tx, actor, scope);
  });
  await recordPointChanges(actor, changes);
}

export async function syncAllPoints(actor: JwtUser | null): Promise<void> {
  const changes = await db.transaction(async (tx) => {
    await lockPoints(tx);
    return [
      ...(await syncMembershipPointsTx(tx, actor)),
      ...(await syncAttendancePointsTx(tx, actor)),
    ];
  });
  await recordPointChanges(actor, changes);
}

export async function adjustPoints(
  actor: JwtUser,
  userId: string,
  amount: number,
  note: string
): Promise<number> {
  const change = await db.transaction(async (tx) => {
    await lockPoints(tx);
    const settings = await getPointsSettings(tx);
    if (!settings.pointsEnabled) throw new HttpError(422, "Points are disabled");

    const [target] = await tx
      .select({ balance: users.pointsBalance })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!target) throw new HttpError(404, "User not found");
    if (target.balance + amount < 0) {
      throw new HttpError(422, `Balance cannot go below 0 (current balance is ${target.balance})`);
    }

    return applyPointChange(tx, actor, { userId, amount, reason: PointReason.MANUAL, note });
  });
  await recordPointChanges(actor, [change]);
  return change.balanceAfter;
}

export async function getPointsHistory(userId: string): Promise<PointsHistory | null> {
  const [user] = await db
    .select({ balance: users.pointsBalance })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;

  const transactions = await db
    .select({
      id: pointTransactions.id,
      amount: pointTransactions.amount,
      balanceAfter: pointTransactions.balanceAfter,
      reason: pointTransactions.reason,
      projectId: pointTransactions.projectId,
      projectTitle: pointTransactions.projectTitle,
      note: pointTransactions.note,
      context: pointTransactions.context,
      createdByName: pointTransactions.createdByName,
      createdAt: pointTransactions.createdAt,
    })
    .from(pointTransactions)
    .where(eq(pointTransactions.userId, userId))
    .orderBy(desc(pointTransactions.createdAt))
    .limit(HISTORY_LIMIT);

  return {
    balance: user.balance,
    transactions: transactions.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
  };
}

export function startPointsScheduler(): void {
  const state = globalThis as typeof globalThis & { __pointsSyncTimer?: Timer };
  if (state.__pointsSyncTimer) clearInterval(state.__pointsSyncTimer);

  const run = () => syncAllPoints(null).catch((err) => console.error("Points sync failed", err));
  run();
  state.__pointsSyncTimer = setInterval(run, SYNC_INTERVAL_MS);
}
