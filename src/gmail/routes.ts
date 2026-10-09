import { Router } from "express";
import { createRemoteJWKSet } from "jose";
import { EnvConfig } from "../config";
import { notificationHandler } from "./notificationHandler";
import { createRequirePushAuth, derivePushAudience } from "./pushAuth";

export const gmailRouter=Router();

const audience = derivePushAudience(EnvConfig.publicBaseUrl);
const certsUrl = new URL("https://www.googleapis.com/oauth2/v3/certs");
console.log({ event: "push_auth_config", audience, certsUrl });

const requirePushAuth = createRequirePushAuth(
    createRemoteJWKSet(certsUrl),
    audience,
);

gmailRouter.post("/gmail/notification", requirePushAuth, notificationHandler);
