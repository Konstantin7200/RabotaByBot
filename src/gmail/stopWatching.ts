import { getUserGmailClient } from "./getUserGmailClient";

export async function stopWatching(email:string,refresh_token:string){
    const gmail=getUserGmailClient(refresh_token);
    await gmail.users.stop({userId:email});
}