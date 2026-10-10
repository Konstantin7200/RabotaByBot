import { Request, Response } from "express";
import { isNotificationMessageBody } from "./validateNotificationBody";
import { UnvalidatedNotificationBody, validateNotificationPayload } from "./validateNotificationPayload";
import { getDataFromMessages } from "./getMessages";
import { getMessageIds } from "./getMessageIds";
import { addNotifications, AddNotificationType, listByMessageIds, listDeliverableByMailbox } from "../db/notificationRepository";
import { advanceBasis, getMailbox, setAccessFailure } from "../db/mailboxRepository";
import { deliverBatchUntilTerminal } from "../bot/deliverBatch";
import { getUserGmailClient } from "./getUserGmailClient";
import { classifyAccessError } from "./classifyAccessError";
import { notifyMailboxOwner } from "../bot/notifyMailboxOwner";
import { reportPipelineSuccess, reportTransientFailure } from "../bot/failureNotice";
import { reportUnreadableToken } from "./reportUnreadableToken";
import { MESSAGE_WATCH_EXPIRED, MESSAGE_MAIL_PROCESSING_ERROR } from "../constants";
import { MailboxesTable } from "../db/entityTypes";


export async function notificationHandler(req: Request, res: Response) {
    const body = req.body;

    if (!isNotificationMessageBody(body)) {
        res.status(400).json({ error: "Invalid Pub/Sub message format" });
        return;
    }

    let decoded: UnvalidatedNotificationBody;
    try {
        decoded = JSON.parse(Buffer.from(body.message.data, "base64").toString("utf-8"));
        if(!validateNotificationPayload(decoded))
            throw new Error('Bad notification payload');
    } catch {
        res.status(400).json({ error: "Invalid message payload" });
        return;
    }

    let loadedMailbox: MailboxesTable | null = null;
    try {
        const mailbox = await getMailbox(decoded.emailAddress);
        loadedMailbox = mailbox;
        if (mailbox === null || mailbox.accessStatus === "unlinked") {
            res.status(200).send();
            return;
        }
        if (mailbox.refreshToken === null) {
            await reportUnreadableToken(mailbox);
            res.status(200).send();
            return;
        }
        if (mailbox.accessStatus !== "active") {
            res.status(500).send();
            return;
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
            // A redelivery after budget_exceeded scans from the already-advanced
            // basis and finds nothing, while the rows inserted by the earlier
            // attempt may still be pending - fall back to every deliverable row
            // of this mailbox so the push is acked only once they are terminal.
            const targets=rows.length>0?rows:await listDeliverableByMailbox(mailbox.id);
            if(targets.length===0){
                res.status(200).send();
                return;
            }
            const outcome=await deliverBatchUntilTerminal(targets.map((r)=>r.id));
            res.status(outcome==='terminal'?200:503).send();
        }
        catch(err){
            console.log({ event: "push_batch_failed", email: decoded.emailAddress, err: String(err) });
            return res.status(500).send();
        }
    } catch (err) {
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
        res.status(500).send();
    }
}
