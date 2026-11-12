import { and, eq, exists, gte, lte, not } from "drizzle-orm";

import { AuditAction, AuditEntityType } from "@/constants/enums";
import { userActivations, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { sendMembershipEndedEmail } from "@/lib/email";
import { env } from "@/lib/env";

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const SEND_HOUR = 9;

type SendEmail = (to: string, name: string) => Promise<void>;

function localHour(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hourCycle: "h23" })
    .formatToParts(now)
    .find((part) => part.type === "hour");
  return Number(hour?.value);
}

function activeOn(date: string) {
  return exists(
    db
      .select({ id: userActivations.id })
      .from(userActivations)
      .where(
        and(
          eq(userActivations.userId, users.id),
          lte(userActivations.startDate, date),
          gte(userActivations.endDate, date)
        )
      )
  );
}

async function sendOrLog(to: string, name: string, send: SendEmail): Promise<void> {
  if (env.ENV === "production") {
    await send(to, name);
  } else {
    console.log(`[membership] ENV=${env.ENV}, not emailing ${to} that their membership ended`);
  }
}

export async function notifyEndedMemberships(
  now: Date = new Date(),
  send: SendEmail = sendMembershipEndedEmail
): Promise<number> {
  const today = now.toISOString().slice(0, 10);

  await db
    .update(users)
    .set({ membershipWasActive: true })
    .where(and(not(users.membershipWasActive), activeOn(today)));

  if (localHour(now, env.APP_TIME_ZONE) !== SEND_HOUR) return 0;

  const ended = await db
    .select({ id: users.id })
    .from(users)
    .where(and(users.membershipWasActive, not(activeOn(today))));

  let sent = 0;
  for (const { id } of ended) {
    const [claimed] = await db
      .update(users)
      .set({ membershipWasActive: false })
      .where(and(eq(users.id, id), users.membershipWasActive, not(activeOn(today))))
      .returning({ name: users.name, email: users.email });
    if (!claimed) continue;

    try {
      await sendOrLog(claimed.email, claimed.name, send);
    } catch (err) {
      console.error(`Failed to send membership ended email to ${claimed.email}`, err);
      await db.update(users).set({ membershipWasActive: true }).where(eq(users.id, id));
      continue;
    }

    sent++;
    await recordAudit(null, {
      action: AuditAction.SEND_EMAIL,
      entityType: AuditEntityType.ACTIVATION,
      entityId: id,
      entityLabel: claimed.name,
      metadata: {
        userId: id,
        email: claimed.email,
        notice: "Membership ended",
        delivered: env.ENV === "production",
      },
    });
  }
  return sent;
}

export function startMembershipScheduler(): void {
  const state = globalThis as typeof globalThis & { __membershipCheckTimer?: Timer };
  if (state.__membershipCheckTimer) clearInterval(state.__membershipCheckTimer);

  const run = () =>
    notifyEndedMemberships().catch((err) => console.error("Membership check failed", err));
  run();
  state.__membershipCheckTimer = setInterval(run, CHECK_INTERVAL_MS);
}
