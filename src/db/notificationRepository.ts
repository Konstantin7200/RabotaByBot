import { and, count, desc, eq, gt, lt, lte } from "drizzle-orm";
import { db } from ".";
import { InsertedNotification } from "./entityTypes";
import { notificationsTable } from "./schema";
import { BACKOFF_MULT, BACKOFF_VALUE_MS, MAX_NOTIFICATION_ATTEMPTS, STALE_PENDING_MS } from "../constants";

type AddNotificationType=Omit<InsertedNotification,'status'|'attempts'|'nextAttemptAt'|'createdAt'>
export async function addNotification(val:AddNotificationType){
    const valForDb:InsertedNotification={
        ...val,
        status:'pending',
        attempts:0,
        nextAttemptAt:new Date(),
        createdAt:new Date(),
    }
    const rows=await db.insert(notificationsTable).values(valForDb).onConflictDoNothing().returning();
    return rows.length>0?rows[0]:null;
}
export async function setNotificationDelivered(gmailMessageId:string,mailboxId:number) {
    await db.update(notificationsTable).set({status:'sent',sentAt:new Date()}).where(and(
        eq(notificationsTable.gmailMessageId,gmailMessageId),
        eq(notificationsTable.mailboxId,mailboxId),
    ));
}

export async function recordFailure(id:number, error:string) {
    const data=await db.select().from(notificationsTable).where(eq(notificationsTable.id,id)).limit(1);
    const notif=data[0];
    if(notif===undefined||notif.status!=='pending')
        return;
    const newAttempts=notif.attempts+1;
    const updateBody:Partial<InsertedNotification>={
        lastError:error,
        attempts:newAttempts,
        nextAttemptAt:new Date(Date.now()+BACKOFF_VALUE_MS*Math.pow(BACKOFF_MULT,notif.attempts)),
    }
    if(newAttempts>=MAX_NOTIFICATION_ATTEMPTS)
        updateBody.status='failed';
    await db.update(notificationsTable).set(updateBody).where(eq(notificationsTable.id,id));
}

export async function markStaleAsSent() {
    const rows=await db.update(notificationsTable).set({status:'sent'}).where(and(
        eq(notificationsTable.status,'pending'),
        lt(notificationsTable.createdAt,new Date(Date.now()-STALE_PENDING_MS)),
    )).returning();
    return rows.length;
}

export async function claimDueRetries() {
    return db.select().from(notificationsTable).where(and(
        eq(notificationsTable.status,'pending'),
        lte(notificationsTable.nextAttemptAt,new Date()),
        gt(notificationsTable.createdAt,new Date(Date.now()-STALE_PENDING_MS)),
    ));
}

export async function replayFailed() {
    const rows=await db.update(notificationsTable).set({
        status:'pending',
        attempts:0,
        nextAttemptAt:new Date(),
    }).where(eq(notificationsTable.status,'failed')).returning();
    return rows.length;
}

export async function cleanupOlderThan(cutoff:Date) {
    const rows=await db.delete(notificationsTable).where(and(
        eq(notificationsTable.status,'sent'),
        lt(notificationsTable.createdAt,cutoff),
    )).returning();
    return rows.length;
}

export async function getRecentProblems(mailboxId:number) {
    const failures=await db.select().from(notificationsTable).where(and(
        eq(notificationsTable.mailboxId,mailboxId),
        eq(notificationsTable.status,'failed'),
    )).orderBy(desc(notificationsTable.createdAt)).limit(1);
    const stuck=await db.select({stuckCount:count()}).from(notificationsTable).where(and(
        eq(notificationsTable.mailboxId,mailboxId),
        eq(notificationsTable.status,'pending'),
        lt(notificationsTable.createdAt,new Date(Date.now()-STALE_PENDING_MS)),
    ));
    const failure=failures[0];
    return {
        lastFailure:failure===undefined?null:{
            lastError:failure.lastError,
            createdAt:failure.createdAt,
            attempts:failure.attempts,
        },
        stuckCount:stuck[0].stuckCount,
    };
}
