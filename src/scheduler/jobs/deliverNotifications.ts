import { log } from "../../logger";
import { claimDueRetries, markStaleAsSent, recordFailure } from "../../db/notificationRepository";
import { deliverNotification } from "../../bot/deliverNotification";

let inFlight: Promise<void> | null = null;

// M7: after this many consecutive claim (DB) errors the pass backs off for a
// minute instead of hammering a down database on every scheduler tick.
const DB_ERROR_THRESHOLD = 3;
const DB_ERROR_COOLDOWN_MS = 60_000;
let consecutiveDbErrors = 0;
let cooldownUntil = 0;

// Test-only: reset the in-memory backoff state between cases.
export function resetDeliveryBackoffForTests() {
    consecutiveDbErrors = 0;
    cooldownUntil = 0;
}

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
            log.info({ event: "stale_sweep_boot", stale });
    } catch (err) {
        log.error({ event: "stale_sweep_boot_failed", err: String(err) });
    }
}

async function doPass(): Promise<void> {
    if (Date.now() < cooldownUntil) {
        log.info({ event: "delivery_pass_cooldown", remainingMs: cooldownUntil - Date.now() });
        return;
    }
    let due: Awaited<ReturnType<typeof claimDueRetries>>;
    try {
        due = await claimDueRetries();
    } catch (err) {
        consecutiveDbErrors += 1;
        if (consecutiveDbErrors >= DB_ERROR_THRESHOLD)
            cooldownUntil = Date.now() + DB_ERROR_COOLDOWN_MS;
        throw err;
    }
    consecutiveDbErrors = 0;
    if (due.length === 0)
        return;
    log.info({ event: "delivery_pass", due: due.length });
    for (const row of due) {
        try {
            await deliverNotification(row);
        } catch (err) {
            log.error({ event: "delivery_attempt_error", id: row.id, err: String(err) });
            // M7: deliverNotification records its own failures for send errors;
            // this defensive record covers unexpected throws (e.g. a DB error
            // after the Telegram send) so the row still ages out via attempts.
            try {
                await recordFailure(row.id, String(err));
            } catch (recordErr) {
                log.error({ event: "delivery_failure_record_error", id: row.id, err: String(recordErr) });
            }
        }
    }
}
