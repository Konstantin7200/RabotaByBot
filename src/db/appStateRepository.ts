import { eq } from "drizzle-orm";
import { db } from ".";
import { appStateTable } from "./schema";

export const HEARTBEAT_KEY = "last_heartbeat";

export async function getHeartbeat(): Promise<Date | null> {
    const rows = await db
        .select()
        .from(appStateTable)
        .where(eq(appStateTable.key, HEARTBEAT_KEY))
        .limit(1);
    return rows.length > 0 ? rows[0].updatedAt : null;
}

export async function touchHeartbeat(at: Date): Promise<void> {
    await db
        .insert(appStateTable)
        .values({ key: HEARTBEAT_KEY, updatedAt: at })
        .onConflictDoUpdate({
            target: appStateTable.key,
            set: { updatedAt: at },
        });
}
