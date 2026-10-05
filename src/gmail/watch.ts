import { EnvConfig } from "../config";
import { getUserGmailClient } from "./getUserGmailClient";

export async function watch(email:string,refresh_token:string,access_token?:string){
    const gmail=getUserGmailClient(refresh_token,access_token);
    const response=await gmail.users.watch({
        userId:email,
        requestBody:{
        topicName:EnvConfig.googleAuth.topicName
    }})
    return {
        historyId:response.data.historyId,
        expiration:response.data.expiration
    }
}