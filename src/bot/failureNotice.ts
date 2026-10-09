import { claimFailureNotice, registerPipelineSuccess, registerTransientFailure } from "../db/mailboxRepository";
import { notifyMailboxOwner } from "./notifyMailboxOwner";
import { MESSAGE_DELIVERY_RESTORED, MESSAGE_PERSISTENT_FAILURE, PERSISTENT_FAILURE_THRESHOLD } from "../constants";

// US-9: notify the owner only when failures are persistent (N consecutive),
// never on a one-off blip.
export async function reportTransientFailure(mailboxId: number, email: string): Promise<void> {
    const count = await registerTransientFailure(mailboxId);
    if (count < PERSISTENT_FAILURE_THRESHOLD)
        return;
    const claimed = await claimFailureNotice(mailboxId);
    if (!claimed)
        return;
    await notifyMailboxOwner(mailboxId, MESSAGE_PERSISTENT_FAILURE(email));
}

// US-10: "working again" only for owners who actually got the failure notice.
export async function reportPipelineSuccess(mailboxId: number, email: string): Promise<void> {
    const owed = await registerPipelineSuccess(mailboxId);
    if (!owed)
        return;
    await notifyMailboxOwner(mailboxId, MESSAGE_DELIVERY_RESTORED(email));
}
