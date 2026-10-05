import { OAuth2Client } from "google-auth-library";
import { EnvConfig } from "../config";
import { gmail } from "@googleapis/gmail";

export function getUserGmailClient(refreshToken:string,accessToken?:string) {
    const auth = new OAuth2Client(
        EnvConfig.googleAuth.clientId,
        EnvConfig.googleAuth.secret,
        EnvConfig.googleAuth.redirectUri
    );
    auth.setCredentials({refresh_token:refreshToken,...(accessToken!==undefined&&{access_token:accessToken})});

    return gmail({version:'v1',auth});
}