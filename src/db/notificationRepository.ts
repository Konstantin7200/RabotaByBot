import { and, count, desc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from ".";
import { InsertedNotification } from "./entityTypes";
import { notificationsTable } from "./schema";
import { STALE_PENDING_MS } from "../constants";
import { nextFailureState } from "./notificationFailureState";

export type AddNotificationType = Omit<InsertedNotification, 'status' | 'attempts' | 'nextAttemptAt' | 'createdAt'>
export async function addNotification(val: AddNotificationType) {
    const valForDb: InsertedNotification = {
        ...val,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
        createdAt: new Date(),
    }
    const rows = await db.insert(notificationsTable).values(valForDb).onConflictDoNothing().returning();
    return rows.length > 0 ? rows[0] : null;
}
export async function addNotifications(values: AddNotificationType[]): Promise<number> {
    const valuesForDb: InsertedNotification[] = values.map((val) => {
        return {
            ...val,
            status: 'pending',
            attempts: 0,
            nextAttemptAt: new Date(),
            createdAt: new Date(),
        }
    })
    const rows = await db.insert(notificationsTable).values(valuesForDb).onConflictDoNothing().returning();
    return rows.length;
}
export async function listByMessageIds(mailboxId: number, gmailMessageIds: string[]) {
    return db.select().from(notificationsTable).where(and(
        eq(notificationsTable.mailboxId, mailboxId),
        inArray(notificationsTable.gmailMessageId, gmailMessageIds),
    ));
}
export async function getByIds(ids: number[]) {
    return db.select().from(notificationsTable).where(inArray(notificationsTable.id, ids));
}
export async function setNotificationDelivered(gmailMessageId: string, mailboxId: number) {
    await db.update(notificationsTable).set({ status: 'sent', sentAt: new Date() }).where(and(
        eq(notificationsTable.gmailMessageId, gmailMessageId),
        eq(notificationsTable.mailboxId, mailboxId),
    ));
}

export async function recordFailure(id: number, error: string) {
    const data = await db.select().from(notificationsTable).where(eq(notificationsTable.id, id)).limit(1);
    const notif = data[0];
    if (notif === undefined || notif.status !== 'pending')
        return;
    const state = nextFailureState(notif, error, new Date());
    const updateBody: Partial<InsertedNotification> = {
        lastError: state.lastError,
        attempts: state.attempts,
        nextAttemptAt: state.nextAttemptAt,
    }
    if (state.status !== notif.status)
        updateBody.status = state.status;
    await db.update(notificationsTable).set(updateBody).where(eq(notificationsTable.id, id));
}

function pendingAgeExpr() {
    return sql`coalesce(${notificationsTable.replayedAt}, ${notificationsTable.createdAt})`;
}

function staleCutoff(now: Date) {
    return new Date(now.getTime() - STALE_PENDING_MS);
}

// FR-7: recovery-time rule only ("при восстановлении записи pending старше X").
// Called from sweepStaleOnBoot() on boot, never from the regular delivery pass -
// a routine restart must deliver rows, not sweep them (FR-11: no loss).
export async function markStaleAsSent(now: Date = new Date()) {
    const rows = await db.update(notificationsTable).set({ status: 'sent', sentAt: now }).where(and(
        eq(notificationsTable.status, 'pending'),
        sql`${pendingAgeExpr()} < ${staleCutoff(now)}`,
    )).returning();
    return rows.length;
}

export async function claimDueRetries(now: Date = new Date()) {
    return db.select().from(notificationsTable).where(and(
        eq(notificationsTable.status, 'pending'),
        lte(notificationsTable.nextAttemptAt, now),
        sql`${pendingAgeExpr()} > ${staleCutoff(now)}`,
    ));
}

export async function replayFailed(now: Date = new Date()) {
    const rows = await db.update(notificationsTable).set({
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now,
        replayedAt: now,
    }).where(eq(notificationsTable.status, 'failed')).returning();
    return rows.length;
}

export async function cleanupOlderThan(cutoff: Date) {
    const rows = await db.delete(notificationsTable).where(and(
        eq(notificationsTable.status, 'sent'),
        lt(notificationsTable.createdAt, cutoff),
    )).returning();
    return rows.length;
}

export async function getRecentProblems(mailboxId: number) {
    const failures = await db.select().from(notificationsTable).where(and(
        eq(notificationsTable.mailboxId, mailboxId),
        eq(notificationsTable.status, 'failed'),
    )).orderBy(desc(notificationsTable.createdAt)).limit(1);
    const stuck = await db.select({ stuckCount: count() }).from(notificationsTable).where(and(
        eq(notificationsTable.mailboxId, mailboxId),
        eq(notificationsTable.status, 'pending'),
        // Replayed rows get a fresh window (FR-7/FR-11): measure from
        // replayedAt when present, same as the stale pass does.
        sql`${pendingAgeExpr()} < ${staleCutoff(new Date())}`,
    ));
    const failure = failures[0];
    return {
        lastFailure: failure === undefined ? null : {
            lastError: failure.lastError,
            createdAt: failure.createdAt,
            attempts: failure.attempts,
        },
        stuckCount: stuck[0].stuckCount,
    };
}
