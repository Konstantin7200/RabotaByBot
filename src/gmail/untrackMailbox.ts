import { unlinkMailbox } from "../db/mailboxRepository";
import { MailboxesTable } from "../db/entityTypes";
import { revokeToken } from "./revokeToken";
import { stopWatching } from "./stopWatching";

export type UntrackResult = { stopped: boolean; revoked: boolean };

export async function untrackMailbox(mailbox: MailboxesTable): Promise<UntrackResult> {
    if (mailbox.refreshToken === null) {
        if (mailbox.userId !== null)
            await unlinkMailbox(mailbox.userId);
        return { stopped: false, revoked: false };
    }
    let stopped = false;
    let revoked = false;
    try {
        await stopWatching(mailbox.email, mailbox.refreshToken);
        stopped = true;
    } catch (err) {
        console.log({ event: "watch_stop_failed", email: mailbox.email, err: String(err) });
    }
    try {
        await revokeToken(mailbox.refreshToken);
        revoked = true;
    } catch (err) {
        console.log({ event: "token_revoke_failed", email: mailbox.email, err: String(err) });
    }
    if (mailbox.userId !== null) {
        await unlinkMailbox(mailbox.userId);
    }
    return { stopped, revoked };
}
