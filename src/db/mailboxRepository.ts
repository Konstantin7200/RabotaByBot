import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from ".";
import { InsertedMailbox, MailboxesTable } from "./entityTypes";
import { accessStatusEnum, mailboxesTable, usersTable } from "./schema";

type CreatedMailbox=Omit<InsertedMailbox,'linkedAt'|'tokenGrantedAt'|'accessStatus'|'historyIdBasis'|'watchExpiration'>
export async function createMailbox(value:CreatedMailbox){
    const valueForDb:InsertedMailbox={
        ...value,
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
        tokenGrantedAt:null,
        historyIdBasis:null,
        historyIdBasisAt:null
    }
    const rows=await db.update(mailboxesTable).set(updateValue).where(eq(mailboxesTable.userId,userId)).returning();
    return rows.length>0?rows[0]:null;
}

export async function getMailbox(email:string) {
    const data=await db.select().from(mailboxesTable).where(eq(mailboxesTable.email,email)).limit(1);
    return data.length>0?data[0]:null;
}

export async function getByUserId(userId:number) {
    const data=await db.select().from(mailboxesTable).where(eq(mailboxesTable.userId,userId)).limit(1);
    return data.length>0?data[0]:null;
}

export async function getMailboxByChatId(chatId:string) {
    const data=await db.select().from(mailboxesTable).innerJoin(usersTable,eq(usersTable.id,mailboxesTable.userId)).where(eq(usersTable.chatId,chatId)).limit(1);
    return data.length>0?data[0].mailboxes:null;
}

export async function setWatchSuccess(email:string,historyIdBasis:string,watchExpiration:Date) {
    await db.update(mailboxesTable).set({
        historyIdBasis:sql`COALESCE(${mailboxesTable.historyIdBasis}, ${historyIdBasis})`,
        historyIdBasisAt: sql`COALESCE(${mailboxesTable.historyIdBasisAt}, CASE WHEN ${mailboxesTable.historyIdBasis} IS NULL THEN CURRENT_TIMESTAMP ELSE NULL END)`,
        watchExpiration,
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
    return db.select({
        mailbox: mailboxesTable,
        chatId: usersTable.chatId,
    }).from(mailboxesTable).innerJoin(usersTable,eq(mailboxesTable.userId,usersTable.id)).where(eq(mailboxesTable.accessStatus,'active'));
}

export async function listDueForRenewal(threshold:Date):Promise<MailboxesTable[]> {
    return db.select().from(mailboxesTable).where(and(
        eq(mailboxesTable.accessStatus,'active'),
        isNotNull(mailboxesTable.refreshToken),
        or(isNull(mailboxesTable.watchExpiration),lt(mailboxesTable.watchExpiration,threshold)),
    ));
}
