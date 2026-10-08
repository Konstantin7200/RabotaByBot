import { Context } from "grammy";
import { getMailboxByChatId } from "../db/mailboxRepository";
import { getByChatId } from "../db/userRepository";
import { getRecentProblems } from "../db/notificationRepository";
import { createDeliveryProblemsWarning, MESSAGE_CHAT_BLOCKED, MESSAGE_FOR_NO_MAILBOX_CONNECTED, TOKEN_EXPIRE_MS } from "../constants";
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
    const user=await getByChatId(chatId.toString());
    const chatBlocked=user!==null&&user.chatStatus==='blocked';
    const problems=await getRecentProblems(mailbox.id);

    sendMessage(chatId,createStatusMessage(watchExpiration,email,tokenExpiresAt,mailbox.accessStatus,chatBlocked,problems));
}

export function createStatusMessage(watchExpiration:string,email:string,tokenExpiresAt:string,accessStatus:string,chatBlocked:boolean,problems:{stuckCount:number;lastFailure:{lastError:string|null;attempts:number}|null}){
    const warning=accessStatus==='active'
        ? ''
        : `\nWarning: tracking is stopped (${accessStatus}).\nRun /start to re-link the mailbox`;
    const blocked=chatBlocked?`\n${MESSAGE_CHAT_BLOCKED}`:'';
    const delivery=problems.stuckCount>0||problems.lastFailure!==null
        ? `\n${createDeliveryProblemsWarning(problems.stuckCount,problems.lastFailure?.lastError??null,problems.lastFailure?.attempts??0)}`
        : '';
    return `Email:${email}\nWatch expiration:${watchExpiration} UTC\nToken Expiration:${tokenExpiresAt} UTC${warning}${blocked}${delivery}`;
}
