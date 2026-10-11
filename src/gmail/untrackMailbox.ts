import { log } from "../logger";
import { unlinkMailbox } from "../db/mailboxRepository";
import { MailboxesTable } from "../db/entityTypes";
import { revokeToken } from "./revokeToken";
import { stopWatching } from "./stopWatching";

export type UntrackResult = { stopped: boolean; revoked: boolean };

// Remote half of FR-9 (users.stop + oauth2.revoke), no database writes.
// The OAuth callback runs this after linkMailboxAtomically has committed the
// replaced-mailbox unlink; /unlink still uses the full untrackMailbox below.
export async function remoteUntrack(mailbox: MailboxesTable): Promise<UntrackResult> {
    if (mailbox.refreshToken === null)
        return { stopped: false, revoked: false };
    let stopped = false;
    let revoked = false;
    try {
        await stopWatching(mailbox.email, mailbox.refreshToken);
        stopped = true;
    } catch (err) {
        log.warn({ event: "watch_stop_failed", email: mailbox.email, err: String(err) });
    }
    try {
        await revokeToken(mailbox.refreshToken);
        revoked = true;
    } catch (err) {
        log.warn({ event: "token_revoke_failed", email: mailbox.email, err: String(err) });
    }
    return { stopped, revoked };
}

export async function untrackMailbox(mailbox: MailboxesTable): Promise<UntrackResult> {
    if (mailbox.refreshToken === null) {
        if (mailbox.userId !== null)
            await unlinkMailbox(mailbox.userId);
        return { stopped: false, revoked: false };
    }
    const result = await remoteUntrack(mailbox);
    if (mailbox.userId !== null) {
        await unlinkMailbox(mailbox.userId);
    }
    return result;
}
