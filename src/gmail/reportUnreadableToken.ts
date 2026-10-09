import { MailboxesTable } from "../db/entityTypes";
import { setAccessFailure } from "../db/mailboxRepository";
import { notifyMailboxOwner } from "../bot/notifyMailboxOwner";
import { MESSAGE_WATCH_EXPIRED } from "../constants";

// The row still has a stored refresh token, but it cannot be decrypted (fresh
// start after encryption landed, or TOKEN_ENCRYPTION_KEY changed). Tracking
// cannot continue until the user re-links — mark access lost and say so
// instead of failing silently (FR-12/FR-13).
export async function reportUnreadableToken(mailbox: MailboxesTable): Promise<void> {
    if (mailbox.accessStatus !== "active")
        return;
    await setAccessFailure(mailbox.email, "expired");
    await notifyMailboxOwner(mailbox.id, MESSAGE_WATCH_EXPIRED(mailbox.email));
    console.log({ event: "refresh_token_unreadable_marked", email: mailbox.email });
}
