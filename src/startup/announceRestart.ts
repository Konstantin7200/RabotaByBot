import { DOWNTIME_THRESHOLD_MS, MESSAGE_BACK_ONLINE } from "../constants";
import { getHeartbeat, touchHeartbeat } from "../db/appStateRepository";
import { listActive } from "../db/mailboxRepository";
import { sendMessage } from "../bot/sendMessage";

export async function announceRestart(now: Date = new Date()): Promise<void> {
    const last = await getHeartbeat();
    const down = last === null || now.getTime() - last.getTime() > DOWNTIME_THRESHOLD_MS;
    if (!down) {
        await touchHeartbeat(now);
        console.log({ event: "restart_silent", lastHeartbeat: last });
        return;
    }
    const active = await listActive();
    for (const row of active) {
        try {
            await sendMessage(parseInt(row.chatId, 10), MESSAGE_BACK_ONLINE);
        } catch (err) {
            console.log(err);
        }
    }
    await touchHeartbeat(now);
    console.log({ event: "restart_announced", chats: active.length });
}
