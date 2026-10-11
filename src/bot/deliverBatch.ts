import { BATCH_POLL_MAX_MS, BATCH_POLL_MIN_MS, INLINE_DELIVERY_BUDGET_MS } from "../constants";
import { getByIds } from "../db/notificationRepository";
import { runDeliveryPass } from "../scheduler/jobs/deliverNotifications";

export type BatchOutcome = "terminal" | "budget_exceeded";

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function deliverBatchUntilTerminal(
    ids: number[],
    opts?: { sleep?: (ms: number) => Promise<void>; now?: () => number },
): Promise<BatchOutcome> {
    const sleep = opts?.sleep ?? defaultSleep;
    const now = opts?.now ?? Date.now;
    const start = now();
    while (now() - start < INLINE_DELIVERY_BUDGET_MS) {
        let rows = await getByIds(ids);
        if (rows.every((r) => r.status !== "pending"))
            return "terminal";
        await runDeliveryPass();
        rows = await getByIds(ids);
        if (rows.every((r) => r.status !== "pending"))
            return "terminal";
        const nextDue = Math.min(...rows.filter((r) => r.status === "pending").map((r) => r.nextAttemptAt.getTime()));
        const wait = Math.max(BATCH_POLL_MIN_MS, Math.min(BATCH_POLL_MAX_MS, nextDue - now()));
        await sleep(wait);
    }
    return "budget_exceeded";
}
