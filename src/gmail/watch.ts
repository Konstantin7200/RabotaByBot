import { EnvConfig } from "../config";
import { setWatchSuccess } from "../db/mailboxRepository";
import { getUserGmailClient } from "./getUserGmailClient";
import { parseExpiration } from "./parseExpiration";

export async function installWatch(email:string,refresh_token:string,access_token?:string){
    const gmail=getUserGmailClient(refresh_token,access_token);
    const response=await gmail.users.watch({
        userId:email,
        requestBody:{
        topicName:EnvConfig.googleAuth.topicName
    }})
    const {historyId,expiration}=response.data;

    if(typeof historyId!=='string')
        throw new Error('History id is undefined');
    if(typeof expiration!=='string')
        throw new Error('Expiration is undefined');
    return {historyId,expirationDate:parseExpiration(expiration)};
}

export async function watch(email:string,refresh_token:string,access_token?:string){
    const {historyId,expirationDate}=await installWatch(email,refresh_token,access_token);
    await setWatchSuccess(email,historyId,expirationDate);
    return {historyId,expiration:expirationDate.toISOString()};
}
