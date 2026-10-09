import { cleanupOlderThan } from "../../db/notificationRepository";
import { RETENTION_DAYS } from "../../constants";

// Planned retention: drop delivered notifications older than 30 days so the
// journal table stays bounded (NFR data hygiene).
export async function runRetentionCleanup(now: Date = new Date()) {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const removed = await cleanupOlderThan(cutoff);
    if (removed > 0)
        console.log({ event: "retention_cleanup", removed, cutoff });
    return removed;
}
