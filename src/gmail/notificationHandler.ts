import { Request, Response } from "express";
import { isNotificationMessageBody } from "./validateNotificationBody";
import { UnvalidatedNotificationBody, validateNotificationPayload } from "./validateNotificationPayload";
import { getDataFromMessages } from "./getMessages";
import { getMessageIds } from "./getMessageIds";
import { addNotifications, AddNotificationType, listByMessageIds } from "../db/notificationRepository";
import { advanceBasis, getMailbox } from "../db/mailboxRepository";
import { deliverBatchUntilTerminal } from "../bot/deliverBatch";
import { getUserGmailClient } from "./getUserGmailClient";


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

    const mailbox=await getMailbox(decoded.emailAddress);
    if(mailbox===null||mailbox.refreshToken===null){
        throw new Error('Mailbox not found');
    }
    const gmail=getUserGmailClient(mailbox.refreshToken);
    const {messageIds,newHistoryId}=await getMessageIds(gmail,decoded.emailAddress,decoded.historyId);
    const messageData=await getDataFromMessages(gmail,messageIds,decoded.emailAddress);
    try{
        const notifications:AddNotificationType[]=messageData.map((val)=>{
            return {
                vacancy:val.vacancy||'Unknown',
                employer:val.employer||'Unknown',
                subject:val.subject||'Unknown',
                outcome:val.outcome,
                gmailMessageId:val.gmailMessageId,
                mailboxId:mailbox.id
            }
        })
        await addNotifications(notifications);
        const rows=await listByMessageIds(mailbox.id,messageData.map((m)=>m.gmailMessageId));
        await advanceBasis(mailbox.id,newHistoryId);
        if(rows.length===0){
            res.status(200).send();
            return;
        }
        const outcome=await deliverBatchUntilTerminal(rows.map((r)=>r.id));
        res.status(outcome==='terminal'?200:503).send();
    }
    catch(err){
        console.log(err);
        return res.status(500).send();
    }
}
