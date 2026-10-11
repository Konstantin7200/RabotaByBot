import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { isNotificationMessageBody } from "./validateNotificationBody";
import { UnvalidatedNotificationBody, validateNotificationPayload } from "./validateNotificationPayload";
import { processNotification, PushOutcome } from "./processNotification";

function statusForOutcome(outcome: PushOutcome): number {
    if (outcome === "ack")
        return StatusCodes.OK;
    if (outcome === "retry")
        return StatusCodes.SERVICE_UNAVAILABLE;
    return StatusCodes.INTERNAL_SERVER_ERROR;
}

export async function notificationHandler(req: Request, res: Response) {
    const body = req.body;

    if (!isNotificationMessageBody(body)) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: "Invalid Pub/Sub message format" });
        return;
    }

    let decoded: UnvalidatedNotificationBody;
    try {
        decoded = JSON.parse(Buffer.from(body.message.data, "base64").toString("utf-8"));
        if(!validateNotificationPayload(decoded))
            throw new Error('Bad notification payload');
    } catch {
        res.status(StatusCodes.BAD_REQUEST).json({ error: "Invalid message payload" });
        return;
    }

    // The push pipeline (gmail scan, journal, delivery, access-failure side
    // effects) lives in processNotification - this handler only adapts the
    // decoded payload to an HTTP status for Pub/Sub.
    const outcome = await processNotification(decoded);
    res.status(statusForOutcome(outcome)).send();
}
