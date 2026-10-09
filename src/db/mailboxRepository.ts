import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from ".";
import { WATCH_RENEWAL_MIN_INTERVAL_MS } from "../constants";
import { InsertedMailbox, MailboxesTable } from "./entityTypes";
import { accessStatusEnum, mailboxesTable, usersTable } from "./schema";
import { decryptTokenOrNull, encryptSecret } from "./secretBox";

function encryptToken(token: string | null | undefined): string | null | undefined {
    return token === undefined ? undefined : token === null ? null : encryptSecret(token);
}

function decryptRow<T extends { refreshToken: string | null }>(row: T): T {
    return { ...row, refreshToken: decryptTokenOrNull(row.refreshToken) };
}

type CreatedMailbox=Omit<InsertedMailbox,'linkedAt'|'tokenGrantedAt'|'accessStatus'|'historyIdBasis'|'watchExpiration'>
export async function createMailbox(value:CreatedMailbox){
    const valueForDb:InsertedMailbox={
        ...value,
        refreshToken:encryptToken(value.refreshToken)??null,
        linkedAt:new Date(),
        tokenGrantedAt:new Date(),
        accessStatus:'active',
    }
    await db.insert(mailboxesTable).values(valueForDb).onConflictDoUpdate({
        target: mailboxesTable.email,
        set: {
            userId: valueForDb.userId,
            refreshToken: valueForDb.refreshToken,
            tokenGrantedAt: valueForDb.tokenGrantedAt,
            accessStatus: 'active',
            linkedAt: valueForDb.linkedAt,
            tokenExpiryWarnedAt: null,
        },
    });
}
export async function updateMailboxUserId(newUserId:number,email:string) {
    await db.update(mailboxesTable).set({userId:newUserId}).where(eq(mailboxesTable.email,email));
}
export async function unlinkMailbox(userId:number) {
    const updateValue:Partial<InsertedMailbox>={
        accessStatus:'unlinked',
        refreshToken:null,
        userId:null,
        watchExpiration:null,
        watchRenewedAt:null,
        tokenGrantedAt:null,
        tokenExpiryWarnedAt:null,
        consecutiveTransientFailures:0,
        failureNotifiedAt:null,
        historyIdBasis:null,
        historyIdBasisAt:null
    }
    const rows=await db.update(mailboxesTable).set(updateValue).where(eq(mailboxesTable.userId,userId)).returning();
    return rows.length>0?rows[0]:null;
}

export async function getMailbox(email:string) {
    const data=await db.select().from(mailboxesTable).where(eq(mailboxesTable.email,email)).limit(1);
    return data.length>0?decryptRow(data[0]):null;
}

export async function getByUserId(userId:number) {
    const data=await db.select().from(mailboxesTable).where(eq(mailboxesTable.userId,userId)).limit(1);
    return data.length>0?decryptRow(data[0]):null;
}

export async function getMailboxByChatId(chatId:string) {
    const data=await db.select().from(mailboxesTable).innerJoin(usersTable,eq(usersTable.id,mailboxesTable.userId)).where(eq(usersTable.chatId,chatId)).limit(1);
    return data.length>0?decryptRow(data[0].mailboxes):null;
}

export async function setWatchSuccess(email:string,historyIdBasis:string,watchExpiration:Date) {
    await db.update(mailboxesTable).set({
        historyIdBasis:sql`COALESCE(${mailboxesTable.historyIdBasis}, ${historyIdBasis})`,
        historyIdBasisAt: sql`COALESCE(${mailboxesTable.historyIdBasisAt}, CASE WHEN ${mailboxesTable.historyIdBasis} IS NULL THEN CURRENT_TIMESTAMP ELSE NULL END)`,
        watchExpiration,
        watchRenewedAt: new Date(),
        accessStatus:'active'
    }).where(eq(mailboxesTable.email,email));
}

type AccessFailureStatus=Exclude<typeof accessStatusEnum.enumValues[number],'active'|'unlinked'>
export async function setAccessFailure(email:string,accessStatus:AccessFailureStatus) {
    await db.update(mailboxesTable).set({accessStatus}).where(eq(mailboxesTable.email,email));
}

export async function setLastDeliveredAt(id:number,lastDeliveredAt:Date) {
    await db.update(mailboxesTable).set({lastDeliveredAt}).where(eq(mailboxesTable.id,id));
}

// Call only after all notification inserts of this batch are durable:
// basis must never advance past messages that have no journal row yet.
// historyIdBasisAt is stamped together with the basis so the wall-clock time
// always matches the basis write it accompanies.
// Monotonic: an out-of-order push must never move the basis backwards.
export async function advanceBasis(id:number,historyIdBasis:string):Promise<boolean> {
    const current=await db.select({basis:mailboxesTable.historyIdBasis}).from(mailboxesTable).where(eq(mailboxesTable.id,id)).limit(1);
    const existing=current[0]?.basis??null;
    if(existing!==null&&isHistoryIdValue(existing)&&isHistoryIdValue(historyIdBasis)&&BigInt(historyIdBasis)<=BigInt(existing))
        return false;
    await db.update(mailboxesTable).set({historyIdBasis, historyIdBasisAt:new Date()}).where(eq(mailboxesTable.id,id));
    return true;
}

function isHistoryIdValue(value:string):boolean {
    return /^[0-9]+$/.test(value);
}

export async function listActive() {
    const rows=await db.select({
        mailbox: mailboxesTable,
        chatId: usersTable.chatId,
    }).from(mailboxesTable).innerJoin(usersTable,eq(mailboxesTable.userId,usersTable.id)).where(eq(mailboxesTable.accessStatus,'active'));
    return rows.map((row)=>({...row,mailbox:decryptRow(row.mailbox)}));
}

export async function listDueForRenewal(threshold:Date):Promise<MailboxesTable[]> {
    const renewalIntervalAgo=new Date(Date.now()-WATCH_RENEWAL_MIN_INTERVAL_MS);
    const rows=await db.select().from(mailboxesTable).where(and(
        eq(mailboxesTable.accessStatus,'active'),
        isNotNull(mailboxesTable.refreshToken),
        or(
            isNull(mailboxesTable.watchExpiration),
            lt(mailboxesTable.watchExpiration,threshold),
            isNull(mailboxesTable.watchRenewedAt),
            lt(mailboxesTable.watchRenewedAt,renewalIntervalAgo),
        ),
    ));
    return rows.map(decryptRow);
}

// US-8: active mailboxes whose grant is still unexpired and has no
// "login expires soon" notice for the current grant yet.
export async function listDueForTokenExpiryWarning():Promise<MailboxesTable[]> {
    const rows=await db.select().from(mailboxesTable).where(and(
        eq(mailboxesTable.accessStatus,'active'),
        isNotNull(mailboxesTable.refreshToken),
        isNotNull(mailboxesTable.tokenGrantedAt),
        isNull(mailboxesTable.tokenExpiryWarnedAt),
    ));
    return rows.map(decryptRow);
}

export async function markTokenExpiryWarned(id:number) {
    await db.update(mailboxesTable).set({tokenExpiryWarnedAt:new Date()}).where(eq(mailboxesTable.id,id));
}

// US-9: increments the consecutive transient-failure counter atomically and
// returns the new value.
export async function registerTransientFailure(id:number):Promise<number> {
    const rows=await db.update(mailboxesTable)
        .set({consecutiveTransientFailures:sql`${mailboxesTable.consecutiveTransientFailures} + 1`})
        .where(eq(mailboxesTable.id,id))
        .returning({value:mailboxesTable.consecutiveTransientFailures});
    return rows[0]?.value??0;
}

// US-9: one-shot claim of the right to send the persistent-failure notice.
export async function claimFailureNotice(id:number):Promise<boolean> {
    const rows=await db.update(mailboxesTable)
        .set({failureNotifiedAt:new Date()})
        .where(and(eq(mailboxesTable.id,id),isNull(mailboxesTable.failureNotifiedAt)))
        .returning({value:mailboxesTable.id});
    return rows.length>0;
}

// US-10: resets the failure streak; returns true when a persistent-failure
// notice had been sent, i.e. the owner is owed a "working again" message.
export async function registerPipelineSuccess(id:number):Promise<boolean> {
    const current=await db.select({
        notified:mailboxesTable.failureNotifiedAt,
        failures:mailboxesTable.consecutiveTransientFailures,
    }).from(mailboxesTable).where(eq(mailboxesTable.id,id)).limit(1);
    const hadNotice=current[0]?.notified??null;
    if(current.length===0)
        return false;
    if(hadNotice===null&&current[0].failures===0)
        return false;
    await db.update(mailboxesTable)
        .set({consecutiveTransientFailures:0,failureNotifiedAt:null})
        .where(eq(mailboxesTable.id,id));
    return hadNotice!==null;
}
