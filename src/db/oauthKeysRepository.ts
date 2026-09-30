import { eq, lt } from "drizzle-orm";
import { db } from ".";
import { InsertedKey } from "./entityTypes";
import { oauthKeysTable } from "./schema";

export async function createKey(insertedKey:InsertedKey){
    await deleteExpired();
    await db.insert(oauthKeysTable).values(insertedKey).onConflictDoUpdate({ target: oauthKeysTable.chatId, set: { key:insertedKey.key, expiresAt:insertedKey.expiresAt }});
}
export async function takeKey(key:string) {
    const data=await db.delete(oauthKeysTable).where(eq(oauthKeysTable.key,key)).returning();
    const keyFromDb=data[0];
    if(keyFromDb===undefined||keyFromDb.expiresAt<=new Date())
        return null;
    return keyFromDb;
}
async function deleteExpired() {
    await db.delete(oauthKeysTable).where(lt(oauthKeysTable.expiresAt,new Date()));
}
