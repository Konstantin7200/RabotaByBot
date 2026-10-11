import { log } from "../logger";
import { DOWNTIME_THRESHOLD_MS, MESSAGE_BACK_ONLINE } from "../constants";
import { getHeartbeat, touchHeartbeat } from "../db/appStateRepository";
import { listActive } from "../db/mailboxRepository";
import { sendWithRetry, SendRetryOptions } from "../bot/sendWithRetry";

export async function announceRestart(now: Date = new Date(), opts?: SendRetryOptions): Promise<boolean> {
    const last = await getHeartbeat();
    const down = last === null || now.getTime() - last.getTime() > DOWNTIME_THRESHOLD_MS;
    if (!down) {
        await touchHeartbeat(now);
        log.info({ event: "restart_silent", lastHeartbeat: last });
        return false;
    }
    const active = await listActive();
    for (const row of active) {
        try {
            await sendWithRetry(parseInt(row.chatId, 10), MESSAGE_BACK_ONLINE, opts);
        } catch (err) {
            log.error({ event: "back_online_send_failed", chatId: row.chatId, err: String(err) });
        }
    }
    await touchHeartbeat(now);
    log.info({ event: "restart_announced", chats: active.length });
    return true;
}
