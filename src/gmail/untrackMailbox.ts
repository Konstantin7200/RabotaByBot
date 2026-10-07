import { unlinkMailbox } from "../db/mailboxRepository";
import { MailboxesTable } from "../db/entityTypes";
import { revokeToken } from "./revokeToken";
import { stopWatching } from "./stopWatching";

export async function untrackMailbox(mailbox: MailboxesTable) {
    if (mailbox.refreshToken !== null) {
        try {
            await stopWatching(mailbox.email, mailbox.refreshToken);
        } catch (err) {
            console.log(err);
        }
        try {
            await revokeToken(mailbox.refreshToken);
        } catch (err) {
            console.log(err);
        }
    }
    if (mailbox.userId !== null) {
        await unlinkMailbox(mailbox.userId);
    }
}
