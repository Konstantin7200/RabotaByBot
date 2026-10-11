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

// Shared payloads so createMailbox/setWatchSuccess and the transactional
// linkMailboxAtomically can never drift apart.
function mailboxInsertValues(value:CreatedMailbox):InsertedMailbox{
    return {
        ...value,
        refreshToken:encryptToken(value.refreshToken)??null,
        linkedAt:new Date(),
        tokenGrantedAt:new Date(),
        accessStatus:'active',
    }
}
function mailboxUpsertSet(valueForDb:InsertedMailbox){
    return {
        userId: valueForDb.userId,
        refreshToken: valueForDb.refreshToken,
        tokenGrantedAt: valueForDb.tokenGrantedAt,
        accessStatus: 'active' as const,
        linkedAt: valueForDb.linkedAt,
        tokenExpiryWarnedAt: null,
        consecutiveTransientFailures: 0,
        failureNotifiedAt: null,
    };
}
function watchSuccessSet(historyIdBasis:string,watchExpiration:Date){
    return {
        historyIdBasis:sql`COALESCE(${mailboxesTable.historyIdBasis}, ${historyIdBasis})`,
        historyIdBasisAt: sql`COALESCE(${mailboxesTable.historyIdBasisAt}, CASE WHEN ${mailboxesTable.historyIdBasis} IS NULL THEN CURRENT_TIMESTAMP ELSE NULL END)`,
        watchExpiration,
        watchRenewedAt: new Date(),
        accessStatus:'active' as const
    }
}
function unlinkSet():Partial<InsertedMailbox>{
    return {
        accessStatus:'unlinked' as const,
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
}

export async function createMailbox(value:CreatedMailbox){
    const valueForDb=mailboxInsertValues(value);
    await db.insert(mailboxesTable).values(valueForDb).onConflictDoUpdate({
        target: mailboxesTable.email,
        set: mailboxUpsertSet(valueForDb),
    });
}

// FR-3/FR-15: persist a freshly linked mailbox atomically. The replaced
// mailbox's DB unlink runs in the same transaction (before the insert, so
// the unique userId slot is freed) - a failure can no longer leave the user
// with an active row that has no watch, or with the old linkage destroyed
// and no new one. Remote cleanup (users.stop, oauth2.revoke) and Telegram
// notices are the caller's job, after the commit.
export async function linkMailboxAtomically(
    value:CreatedMailbox,
    watch:{historyIdBasis:string,watchExpiration:Date},
    replacedUserId:number|null,
){
    await db.transaction(async (tx)=>{
        if(replacedUserId!==null)
            await tx.update(mailboxesTable).set(unlinkSet()).where(eq(mailboxesTable.userId,replacedUserId));
        const valueForDb=mailboxInsertValues(value);
        await tx.insert(mailboxesTable).values(valueForDb).onConflictDoUpdate({
            target: mailboxesTable.email,
            set: mailboxUpsertSet(valueForDb),
        });
        await tx.update(mailboxesTable).set(watchSuccessSet(watch.historyIdBasis,watch.watchExpiration))
            .where(eq(mailboxesTable.email,value.email));
    });
}

export async function unlinkMailbox(userId:number) {
    const rows=await db.update(mailboxesTable).set(unlinkSet()).where(eq(mailboxesTable.userId,userId)).returning();
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
    await db.update(mailboxesTable).set(watchSuccessSet(historyIdBasis,watchExpiration))
        .where(eq(mailboxesTable.email,email));
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
// Monotonic AND atomic: the guard lives in the UPDATE's WHERE clause so two
// concurrent pushes can never move the basis backwards.
export async function advanceBasis(id:number,historyIdBasis:string):Promise<boolean> {
    const update=db.update(mailboxesTable).set({historyIdBasis, historyIdBasisAt:new Date()});
    const condition=isHistoryIdValue(historyIdBasis)
        ? and(
            eq(mailboxesTable.id,id),
            or(
                isNull(mailboxesTable.historyIdBasis),
                sql`(${mailboxesTable.historyIdBasis} !~ '^[0-9]+$')`,
                sql`(${mailboxesTable.historyIdBasis})::bigint < ${historyIdBasis}::bigint`,
            ),
        )
        : eq(mailboxesTable.id,id);
    const rows=await update.where(condition).returning({value:mailboxesTable.id});
    return rows.length>0;
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

// US-10: atomically claim the right to send the "working again" message and
// reset the failure streak. Concurrent successes can never both claim it.
export async function registerPipelineSuccess(id:number):Promise<boolean> {
    const claimed=await db.update(mailboxesTable)
        .set({failureNotifiedAt:null})
        .where(and(eq(mailboxesTable.id,id),isNotNull(mailboxesTable.failureNotifiedAt)))
        .returning({value:mailboxesTable.id});
    await db.update(mailboxesTable)
        .set({consecutiveTransientFailures:0})
        .where(and(eq(mailboxesTable.id,id),sql`${mailboxesTable.consecutiveTransientFailures} > 0`));
    return claimed.length>0;
}
