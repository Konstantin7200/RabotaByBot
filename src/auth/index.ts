import { OAuth2Client } from "google-auth-library";
import { EnvConfig } from "../config";

export const auth = new OAuth2Client(
    EnvConfig.googleAuth.clientId,
    EnvConfig.googleAuth.secret,
    EnvConfig.googleAuth.redirectUri
);