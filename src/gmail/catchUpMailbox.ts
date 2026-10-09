import { gmail_v1 } from "@googleapis/gmail";
import { AddNotificationType, addNotifications, listByMessageIds } from "../db/notificationRepository";
import { advanceBasis, setAccessFailure } from "../db/mailboxRepository";
import { MailboxesTable } from "../db/entityTypes";
import { getDataFromMessages } from "./getMessages";
import { getMessageIds } from "./getMessageIds";
import { listMessageIdsSince } from "./listMessageIdsSince";
import { getUserGmailClient } from "./getUserGmailClient";
import { deliverBatchUntilTerminal } from "../bot/deliverBatch";
import { notifyMailboxOwner } from "../bot/notifyMailboxOwner";
import { classifyAccessError, isHistoryUnavailable } from "./classifyAccessError";
import { MESSAGE_WATCH_EXPIRED, MESSAGE_MAIL_PROCESSING_ERROR } from "../constants";

export type CatchUpSkipReason = "not_active" | "no_token" | "no_basis";
export type CatchUpResult =
    | { outcome: "skipped"; reason: CatchUpSkipReason }
    | { outcome: "ok"; source: "history" | "messages_fallback";
        scanned: number; inserted: number; delivered: number };

// Journal inserts must be durable before the basis advances; any failure
// before that point leaves the basis untouched so the next pass re-scans.
async function ingestAndDeliver(
    gmail: gmail_v1.Gmail,
    mailbox: MailboxesTable,
    messageIds: string[],
    newHistoryId: string,
    source: "history" | "messages_fallback",
): Promise<CatchUpResult> {
    let inserted = 0;
    let rows: Awaited<ReturnType<typeof listByMessageIds>> = [];
    if (messageIds.length > 0) {
        const messageData = await getDataFromMessages(gmail, messageIds, mailbox.email);
        const notifications: AddNotificationType[] = messageData.map((val) => ({
            vacancy: val.vacancy || "Unknown",
            employer: val.employer || "Unknown",
            subject: val.subject || "Unknown",
            outcome: val.outcome,
            gmailMessageId: val.gmailMessageId,
            mailboxId: mailbox.id,
        }));
        if (notifications.length > 0)
            inserted = await addNotifications(notifications);
        rows = await listByMessageIds(mailbox.id, messageData.map((m) => m.gmailMessageId));
    }
    await advanceBasis(mailbox.id, newHistoryId);
    let delivered = 0;
    if (rows.length > 0) {
        await deliverBatchUntilTerminal(rows.map((r) => r.id));
        delivered = rows.length;
    }
    return { outcome: "ok", source, scanned: messageIds.length, inserted, delivered };
}

async function runFallbackPass(gmail: gmail_v1.Gmail, mailbox: MailboxesTable): Promise<CatchUpResult> {
    // FR-14: never earlier than the current basis; if nothing was delivered
    // yet, fall back to the time access was granted.
    const since = mailbox.historyIdBasisAt ?? mailbox.lastDeliveredAt ?? mailbox.tokenGrantedAt ?? new Date(0);
    const afterUnixSeconds = Math.max(0, Math.floor(since.getTime() / 1000) - 1);
    const ids = await listMessageIdsSince(gmail, mailbox.email, afterUnixSeconds);
    const profile = await gmail.users.getProfile({ userId: mailbox.email });
    const historyId = profile.data.historyId;
    if (typeof historyId !== "string")
        throw new Error("No history id from getProfile");
    return await ingestAndDeliver(gmail, mailbox, ids, historyId, "messages_fallback");
}

async function handleAccessError(err: unknown, mailbox: MailboxesTable): Promise<never> {
    const kind = classifyAccessError(err);
    console.log({ event: "catch_up_mailbox_failed", email: mailbox.email, kind, err });
    if (kind !== "transient" && mailbox.accessStatus === "active") {
        await setAccessFailure(mailbox.email, kind);
        await notifyMailboxOwner(mailbox.id, kind === "expired"
            ? MESSAGE_WATCH_EXPIRED(mailbox.email)
            : MESSAGE_MAIL_PROCESSING_ERROR(mailbox.email));
    }
    throw err;
}

export async function catchUpMailbox(mailbox: MailboxesTable): Promise<CatchUpResult> {
    if (mailbox.accessStatus !== "active")
        return { outcome: "skipped", reason: "not_active" };
    if (mailbox.refreshToken === null)
        return { outcome: "skipped", reason: "no_token" };
    if (mailbox.historyIdBasis === null)
        return { outcome: "skipped", reason: "no_basis" };

    try {
        const gmail = getUserGmailClient(mailbox.refreshToken);
        let scan: Awaited<ReturnType<typeof getMessageIds>>;
        try {
            scan = await getMessageIds(gmail, mailbox.email, mailbox.historyIdBasis);
        } catch (err) {
            if (!isHistoryUnavailable(err))
                throw err;
            return await runFallbackPass(gmail, mailbox);
        }
        return await ingestAndDeliver(gmail, mailbox, scan.messageIds, scan.newHistoryId, "history");
    } catch (err) {
        return await handleAccessError(err, mailbox);
    }
}
