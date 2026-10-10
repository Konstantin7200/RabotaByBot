import { claimDueRetries, markStaleAsSent } from "../../db/notificationRepository";
import { deliverNotification } from "../../bot/deliverNotification";

let inFlight: Promise<void> | null = null;

export function runDeliveryPass(): Promise<void> {
    if (inFlight !== null)
        return inFlight;
    inFlight = doPass().finally(() => { inFlight = null; });
    return inFlight;
}

// FR-7: pending rows older than STALE_PENDING_MS are treated as delivered
// only on recovery (boot), never by the regular passes - a routine restart
// must deliver them instead of silently sweeping them away (FR-11).
export async function sweepStaleOnBoot(): Promise<void> {
    try {
        const stale = await markStaleAsSent();
        if (stale > 0)
            console.log({ event: "stale_sweep_boot", stale });
    } catch (err) {
        console.log({ event: "stale_sweep_boot_failed", err: String(err) });
    }
}

async function doPass(): Promise<void> {
    const due = await claimDueRetries();
    if (due.length === 0)
        return;
    console.log({ event: "delivery_pass", due: due.length });
    for (const row of due) {
        try {
            await deliverNotification(row);
        } catch (err) {
            console.log({ event: "delivery_attempt_error", id: row.id, err: String(err) });
        }
    }
}
