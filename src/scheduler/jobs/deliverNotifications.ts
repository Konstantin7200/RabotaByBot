import { claimDueRetries, markStaleAsSent } from "../../db/notificationRepository";
import { deliverNotification } from "../../bot/deliverNotification";

let inFlight: Promise<void> | null = null;

export function runDeliveryPass(): Promise<void> {
    if (inFlight !== null)
        return inFlight;
    inFlight = doPass().finally(() => { inFlight = null; });
    return inFlight;
}

async function doPass(): Promise<void> {
    const stale = await markStaleAsSent();
    const due = await claimDueRetries();
    if (stale === 0 && due.length === 0)
        return;
    console.log({ event: "delivery_pass", stale, due: due.length });
    for (const row of due) {
        try {
            await deliverNotification(row);
        } catch (err) {
            console.log({ event: "delivery_attempt_error", id: row.id, err: String(err) });
        }
    }
}
