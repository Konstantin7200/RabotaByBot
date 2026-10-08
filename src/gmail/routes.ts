import { Router } from "express";
import { createRemoteJWKSet } from "jose";
import { EnvConfig } from "../config";
import { notificationHandler } from "./notificationHandler";
import { createRequirePushAuth, derivePushAudience } from "./pushAuth";

export const gmailRouter=Router();

const requirePushAuth = createRequirePushAuth(
    createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")),
    derivePushAudience(EnvConfig.googleAuth.redirectUri),
);

gmailRouter.post("/gmail/notification", requirePushAuth, notificationHandler);
