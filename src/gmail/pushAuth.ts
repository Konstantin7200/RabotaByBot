import { RequestHandler } from "express";
import { JWTVerifyGetKey } from "jose";
import { verifyPushAuth } from "./verifyPushAuth";

export function derivePushAudience(redirectUri: string): string {
    return new URL("/gmail/notification", redirectUri).toString();
}

export function createRequirePushAuth(getKey: JWTVerifyGetKey, audience: string): RequestHandler {
    return async (req, res, next) => {
        const authorized = await verifyPushAuth(req.headers.authorization, audience, getKey);
        if (!authorized) {
            console.log({ event: "push_auth_rejected", path: req.path });
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
        next();
    };
}
