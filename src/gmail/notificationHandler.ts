import { Request, Response } from "express";
import { isNotificationMessageBody } from "./validateNotificationBody";
import { UnvalidatedNotificationBody, validateNotificationPayload } from "./validateNotificationPayload";



export function notificationHandler(req: Request, res: Response): void {
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

    console.log("payload:", decoded);

    res.status(200).send();
}
