import { eq } from "drizzle-orm";
import { db } from ".";
import { InsertedUser } from "./entityTypes";
import { chatStatusEnum, mailboxesTable, usersTable } from "./schema";

export async function createIfNotExists(user: InsertedUser) {
    await db.insert(usersTable).values(user).onConflictDoNothing();
}

export async function getByChatId(chatId: string) {
    const data = await db.select().from(usersTable).where(eq(usersTable.chatId, chatId)).limit(1);
    return data.length > 0 ? data[0] : null;
}

export async function setChatStatus(chatId: string, chatStatus: typeof chatStatusEnum.enumValues[number]) {
    await db.update(usersTable).set({ chatStatus }).where(eq(usersTable.chatId, chatId));
}

export async function getChatId(email:string){
    const data=await db.select({chatId:usersTable.chatId}).from(usersTable).leftJoin(mailboxesTable,eq(mailboxesTable.userId,usersTable.id)).where(eq(mailboxesTable.email,email));
    return data.length>0?data[0].chatId:null;
}

export async function getChatIdByMailboxId(mailboxId:number){
    const data=await db.select({chatId:usersTable.chatId}).from(mailboxesTable).leftJoin(usersTable,eq(mailboxesTable.userId,usersTable.id)).where(eq(mailboxesTable.id,mailboxId)).limit(1);
    if(data.length===0)
        return null;
    return data[0].chatId;
}
