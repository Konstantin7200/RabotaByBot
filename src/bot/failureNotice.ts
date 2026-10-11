import { claimFailureNotice, consumeFailureNotice, registerPipelineSuccess, registerTransientFailure, wasFailureNotified } from "../db/mailboxRepository";
import { notifyMailboxOwner } from "./notifyMailboxOwner";
import { MESSAGE_DELIVERY_RESTORED, MESSAGE_PERSISTENT_FAILURE, PERSISTENT_FAILURE_THRESHOLD } from "../constants";

// US-9: notify the owner only when failures are persistent (N consecutive),
// never on a one-off blip. M5: the one-shot claim is taken AFTER the send
// succeeded (warnTokenExpiry pattern) - a Telegram outage must not consume
// the notice, the next failure pass retries it instead.
export async function reportTransientFailure(mailboxId: number, email: string): Promise<void> {
    const count = await registerTransientFailure(mailboxId);
    if (count < PERSISTENT_FAILURE_THRESHOLD)
        return;
    if (await wasFailureNotified(mailboxId))
        return;
    const sent = await notifyMailboxOwner(mailboxId, MESSAGE_PERSISTENT_FAILURE(email));
    if (!sent) {
        console.log({ event: "persistent_failure_notice_not_sent", mailboxId });
        return;
    }
    await claimFailureNotice(mailboxId);
}

// US-10: "working again" only for owners who actually got the failure notice.
// M5: the streak reset happens immediately (registerPipelineSuccess), but the
// failureNotifiedAt consume happens only after the restore notice was
// delivered - same claim-after-send rule as above.
export async function reportPipelineSuccess(mailboxId: number, email: string): Promise<void> {
    const owed = await registerPipelineSuccess(mailboxId);
    if (!owed)
        return;
    const sent = await notifyMailboxOwner(mailboxId, MESSAGE_DELIVERY_RESTORED(email));
    if (!sent) {
        console.log({ event: "delivery_restored_notice_not_sent", mailboxId });
        return;
    }
    await consumeFailureNotice(mailboxId);
}
