import { getDataFromMessages } from "./getMessages";
import { getMessageIds } from "./getMessageIds";
import { addNotifications, AddNotificationType, listByMessageIds, listDeliverableByMailbox, markStaleAsSentForMailbox } from "../db/notificationRepository";
import { advanceBasis, getMailbox, setAccessFailure } from "../db/mailboxRepository";
import { deliverBatchUntilTerminal } from "../bot/deliverBatch";
import { getUserGmailClient } from "./getUserGmailClient";
import { catchUpMailbox } from "./catchUpMailbox";
import { classifyAccessError, isHistoryUnavailable } from "./classifyAccessError";
import { notifyMailboxOwner } from "../bot/notifyMailboxOwner";
import { reportPipelineSuccess, reportTransientFailure } from "../bot/failureNotice";
import { reportUnreadableToken } from "./reportUnreadableToken";
import { MESSAGE_WATCH_EXPIRED, MESSAGE_MAIL_PROCESSING_ERROR } from "../constants";
import { MailboxesTable } from "../db/entityTypes";
import { NotificationBody } from "./validateNotificationPayload";

// What the webhook should tell Pub/Sub about one decoded push:
// - "ack"  - processed (or intentionally ignored); safe to acknowledge (200)
// - "retry" - not everything reached a terminal state; ask for redelivery (503)
// - "fail" - the push could not be processed; redelivery will not hurt (500)
export type PushOutcome = "ack" | "retry" | "fail";

export async function processNotification(decoded: NotificationBody): Promise<PushOutcome> {
    let loadedMailbox: MailboxesTable | null = null;
    try {
        const mailbox = await getMailbox(decoded.emailAddress);
        loadedMailbox = mailbox;
        if (mailbox === null || mailbox.accessStatus === "unlinked") {
            return "ack";
        }
        if (mailbox.refreshToken === null) {
            await reportUnreadableToken(mailbox);
            return "ack";
        }
        if (mailbox.accessStatus !== "active") {
            return "fail";
        }
        const gmail=getUserGmailClient(mailbox.refreshToken);
        // Scan from the stored basis, not the push cursor: a missed or
        // out-of-order push would otherwise skip the delta (FR-3/FR-7).
        const startHistoryId=mailbox.historyIdBasis??decoded.historyId;
        const {messageIds,newHistoryId}=await getMessageIds(gmail,decoded.emailAddress,startHistoryId);
        const messageData=await getDataFromMessages(gmail,messageIds,decoded.emailAddress);
        try{
            const notifications:AddNotificationType[]=messageData.map((val)=>{
                return {
                    vacancy:val.vacancy||'Unknown',
                    employer:val.employer||'Unknown',
                    subject:val.subject||'Unknown',
                    fromHeader:val.fromHeader,
                    outcome:val.outcome,
                    gmailMessageId:val.gmailMessageId,
                    mailboxId:mailbox.id
                }
            })
            if(notifications.length>0)
                await addNotifications(notifications);
            const rows=await listByMessageIds(mailbox.id,messageData.map((m)=>m.gmailMessageId));
            await advanceBasis(mailbox.id,newHistoryId);
            await reportPipelineSuccess(mailbox.id, mailbox.email);
            // FR-7: rows older than the stale window are treated as delivered
            // before the ack decision, so the push is never acked while a
            // non-terminal row exists - and a stale row can no longer stall
            // the batch below (it is excluded from claimDueRetries).
            const swept=await markStaleAsSentForMailbox(mailbox.id);
            if(swept>0)
                console.log({event:"stale_sweep_inline",email:mailbox.email,count:swept});
            // A redelivery after budget_exceeded scans from the already-advanced
            // basis and finds nothing, while the rows inserted by the earlier
            // attempt may still be pending - fall back to every deliverable row
            // of this mailbox so the push is acked only once they are terminal.
            const targets=rows.length>0?rows:await listDeliverableByMailbox(mailbox.id);
            if(targets.length===0){
                return "ack";
            }
            const outcome=await deliverBatchUntilTerminal(targets.map((r)=>r.id));
            return outcome==='terminal'?"ack":"retry";
        }
        catch(err){
            console.log({ event: "push_batch_failed", email: decoded.emailAddress, err: String(err) });
            return "fail";
        }
    } catch (err) {
        // A stale basis history id fails every push with 404 until the
        // messages.list fallback runs - delegate to the catch-up pass (FR-14)
        // so recovery takes seconds instead of the next daily pass.
        if (isHistoryUnavailable(err) && loadedMailbox !== null
            && loadedMailbox.accessStatus === "active" && loadedMailbox.historyIdBasis !== null) {
            console.log({ event: "push_falls_back_to_catch_up", email: decoded.emailAddress });
            try {
                await catchUpMailbox(loadedMailbox);
                return "ack";
            } catch {
                return "fail";
            }
        }
        const kind = classifyAccessError(err);
        console.log({ event: "push_processing_failed", email: decoded.emailAddress, kind, err: String(err) });
        if (kind === "transient" && loadedMailbox !== null && loadedMailbox.accessStatus === "active") {
            await reportTransientFailure(loadedMailbox.id, loadedMailbox.email);
        } else if (kind !== "transient" && loadedMailbox !== null && loadedMailbox.accessStatus === "active") {
            await setAccessFailure(loadedMailbox.email, kind);
            await notifyMailboxOwner(loadedMailbox.id, kind === "expired"
                ? MESSAGE_WATCH_EXPIRED(loadedMailbox.email)
                : MESSAGE_MAIL_PROCESSING_ERROR(loadedMailbox.email));
        }
        return "fail";
    }
}
