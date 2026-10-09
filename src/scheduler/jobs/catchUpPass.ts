import { replayFailed } from "../../db/notificationRepository";
import { listActive } from "../../db/mailboxRepository";
import { catchUpMailbox } from "../../gmail/catchUpMailbox";

let inFlight: Promise<void> | null = null;

export function runCatchUpPass(): Promise<void> {
    if (inFlight !== null)
        return inFlight;
    inFlight = doPass().finally(() => { inFlight = null; });
    return inFlight;
}

async function doPass(): Promise<void> {
    const replayed = await replayFailed();
    const active = await listActive();
    let failed = 0;
    for (const row of active) {
        try {
            const result = await catchUpMailbox(row.mailbox);
            console.log({ event: "catch_up_mailbox", email: row.mailbox.email, ...result });
        } catch (err) {
            failed++;
            console.log({ event: "catch_up_mailbox_failed", email: row.mailbox.email, err: String(err) });
        }
    }
    console.log({ event: "catch_up_pass", replayed, mailboxes: active.length, failed });
}
