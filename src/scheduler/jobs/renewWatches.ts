import {
    MESSAGE_WATCH_EXPIRED,
    MESSAGE_WATCH_RENEW_ERROR,
    WATCH_RENEWAL_THRESHOLD_MS,
} from "../../constants";
import { listDueForRenewal, setAccessFailure } from "../../db/mailboxRepository";
import { notifyMailboxOwner } from "../../bot/notifyMailboxOwner";
import { watch } from "../../gmail/watch";
import { classifyAccessError } from "../../gmail/classifyAccessError";

export async function renewWatches() {
    const due = await listDueForRenewal(new Date(Date.now() + WATCH_RENEWAL_THRESHOLD_MS));
    console.log({ event: "watch_renewal_check", due: due.length });
    for (const mailbox of due) {
        if (mailbox.refreshToken === null)
            continue;
        try {
            const { expiration } = await watch(mailbox.email, mailbox.refreshToken);
            console.log({ event: "watch_renewed", email: mailbox.email, expiration });
        } catch (err) {
            const watchDead = mailbox.watchExpiration !== null
                && mailbox.watchExpiration.getTime() < Date.now();
            let kind = classifyAccessError(err);
            if (kind === "transient" && !watchDead) {
                console.log({ event: "watch_renewal_transient_error", email: mailbox.email, err: String(err) });
                continue;
            }
            if (kind === "transient")
                kind = "error";
            await setAccessFailure(mailbox.email, kind);
            console.log({ event: "watch_renewal_failed", email: mailbox.email, kind, err: String(err) });
            const text = kind === "expired"
                ? MESSAGE_WATCH_EXPIRED(mailbox.email)
                : MESSAGE_WATCH_RENEW_ERROR(mailbox.email);
            await notifyMailboxOwner(mailbox.id, text);
        }
    }
}
