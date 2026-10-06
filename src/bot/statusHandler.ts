import { Context } from "grammy";
import { getMailboxByChatId } from "../db/mailboxRepository";
import { MESSAGE_FOR_NO_MAILBOX_CONNECTED, TOKEN_EXPIRE_MS } from "../constants";
import { sendMessage } from "./sendMessage";

export async function statusHandler(ctx:Context){
    const chatId=ctx.chatId;
    if(typeof chatId!=='number')
        throw new Error('Chat id is null');
    const mailbox=await getMailboxByChatId(chatId.toString());
    if(mailbox===null)
        return sendMessage(chatId,MESSAGE_FOR_NO_MAILBOX_CONNECTED);
    const watchExpiration=mailbox.watchExpiration?mailbox.watchExpiration.toUTCString():'Expired';
    const email=mailbox.email;
    const tokenExpiresAt=mailbox.tokenGrantedAt?new Date(mailbox.tokenGrantedAt.getTime()+TOKEN_EXPIRE_MS).toUTCString():'Expired';

    sendMessage(chatId,createStatusMessage(watchExpiration,email,tokenExpiresAt));
}

function createStatusMessage(watchExpiration:string,email:string,tokenExpiresAt:string){
    return `Email:${email}\nWatch expiration:${watchExpiration} UTC\nToken Expiration:${tokenExpiresAt} UTC`;
}