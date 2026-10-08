import {
    MESSAGE_WATCH_EXPIRED,
    MESSAGE_WATCH_RENEW_ERROR,
    WATCH_RENEWAL_THRESHOLD_MS,
} from "../../constants";
import { listDueForRenewal, setAccessFailure } from "../../db/mailboxRepository";
import { getChatIdByMailboxId } from "../../db/userRepository";
import { sendMessage } from "../../bot/sendMessage";
import { watch } from "../../gmail/watch";
import { classifyRenewalError } from "../classifyRenewalError";

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
            let kind = classifyRenewalError(err);
            if (kind === "transient" && !watchDead) {
                console.log({ event: "watch_renewal_transient_error", email: mailbox.email, err: String(err) });
                continue;
            }
            if (kind === "transient")
                kind = "error";
            await setAccessFailure(mailbox.email, kind);
            console.log({ event: "watch_renewal_failed", email: mailbox.email, kind, err: String(err) });
            const chatId = await getChatIdByMailboxId(mailbox.id);
            if (chatId === null)
                continue;
            const text = kind === "expired"
                ? MESSAGE_WATCH_EXPIRED(mailbox.email)
                : MESSAGE_WATCH_RENEW_ERROR(mailbox.email);
            sendMessage(parseInt(chatId, 10), text).catch((sendErr) => console.log(sendErr));
        }
    }
}
