import { OAuth2Client } from "google-auth-library";
import { EnvConfig } from "../config";

let auth:OAuth2Client|null=null;
export function getAuth(){
    if(auth!==null)
        return auth;
    auth=new OAuth2Client(
        EnvConfig.googleAuth.clientId,
        EnvConfig.googleAuth.secret,
        EnvConfig.googleAuth.redirectUri
    );
    return auth;
}