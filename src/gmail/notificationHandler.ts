import { Request, Response } from "express";
import { isNotificationMessageBody } from "./validateNotificationBody";
import { UnvalidatedNotificationBody, validateNotificationPayload } from "./validateNotificationPayload";
import { getDataFromMessages } from "./getMessages";
import { getMessageIds } from "./getMessageIds";
import { addNotifications, AddNotificationType } from "../db/notificationRepository";
import { advanceBasis, getMailbox } from "../db/mailboxRepository";
import { NotificationToSend, sendNotifications } from "../bot/sendNotifications";
import { getChatIdByMailboxId } from "../db/userRepository";
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
                gmailMessageId:val.gmailMessageId,
                mailboxId:mailbox.id
            }
        })
        await addNotifications(notifications);
        await advanceBasis(mailbox.id,newHistoryId);
    }
    catch(err){
        console.log(err);
        return res.status(500).send();
    }
    const rawChatId=await getChatIdByMailboxId(mailbox.id);
    if(rawChatId===null)
    {
        throw new Error('Mailbox not found');
    }
    const numChatId=parseInt(rawChatId,10);
    const notificationsToSend:NotificationToSend[]=messageData.map((val)=>{
        return {
            vacancy:val.vacancy||'Unknown',
            employer:val.employer||'Unknown',
            outcome:(val.subject||'Unknown') as 'Accepted'|'Rejected'|'Unknown',
        }
    })
    await sendNotifications(numChatId,notificationsToSend);
    res.status(200).send();
}
