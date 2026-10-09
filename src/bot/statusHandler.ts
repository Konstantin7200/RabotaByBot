import { Context } from "grammy";
import { EnvConfig } from "../config";
import { getMailboxByChatId } from "../db/mailboxRepository";
import { getByChatId } from "../db/userRepository";
import { getRecentProblems } from "../db/notificationRepository";
import { createDeliveryProblemsWarning, MESSAGE_CHAT_BLOCKED, MESSAGE_FOR_NO_MAILBOX_CONNECTED, TOKEN_EXPIRE_MS } from "../constants";
import { sendMessage } from "./sendMessage";

const LOGIN_EXPIRY_WARNING_MS = 24*60*60*1000;

export function computeTokenExpiresAt(
    tokenGrantedAt: Date | null,
    consentMode: 'testing'|'production' = EnvConfig.googleConsentMode,
): Date | null {
    if (tokenGrantedAt === null)
        return null;
    if (consentMode === 'production')
        return null;
    return new Date(tokenGrantedAt.getTime() + TOKEN_EXPIRE_MS);
}

export async function statusHandler(ctx:Context){
    const chatId=ctx.chatId;
    if(typeof chatId!=='number')
        throw new Error('Chat id is null');
    const mailbox=await getMailboxByChatId(chatId.toString());
    if(mailbox===null)
        return sendMessage(chatId,MESSAGE_FOR_NO_MAILBOX_CONNECTED);
    const user=await getByChatId(chatId.toString());
    const chatBlocked=user!==null&&user.chatStatus==='blocked';
    const problems=await getRecentProblems(mailbox.id);

    await sendMessage(chatId,createStatusMessage({
        email:mailbox.email,
        accessStatus:mailbox.accessStatus,
        chatBlocked,
        problems,
        watchExpiration:mailbox.watchExpiration,
        tokenExpiresAt:computeTokenExpiresAt(mailbox.tokenGrantedAt),
        consentMode:EnvConfig.googleConsentMode,
        lastDeliveredAt:mailbox.lastDeliveredAt,
        credentialsUnreadable:mailbox.accessStatus==='active'&&mailbox.refreshToken===null,
        now:new Date(),
    }));
}

export function createStatusMessage(input:{
    email:string;
    accessStatus:string;
    chatBlocked:boolean;
    problems:{stuckCount:number;lastFailure:{lastError:string|null;attempts:number}|null};
    watchExpiration:Date|null;
    tokenExpiresAt:Date|null;
    consentMode:string;
    lastDeliveredAt:Date|null;
    credentialsUnreadable:boolean;
    now?:Date;
}){
    const now=input.now??new Date();
    const warning=input.accessStatus==='active'
        ? ''
        : `\nWarning: tracking is stopped (${input.accessStatus}).\nRun /start to re-link the mailbox`;
    const unreadable=input.credentialsUnreadable
        ? '\nWarning: the stored login can no longer be read.\nRun /start to re-link the mailbox'
        : '';
    const blocked=input.chatBlocked?`\n${MESSAGE_CHAT_BLOCKED}`:'';
    const delivery=input.problems.stuckCount>0||input.problems.lastFailure!==null
        ? `\n${createDeliveryProblemsWarning(input.problems.stuckCount,input.problems.lastFailure?.lastError??null,input.problems.lastFailure?.attempts??0)}`
        : '';
    const watchExpiration=input.watchExpiration===null
        ? 'Not started'
        : input.watchExpiration.toUTCString();
    let tokenLine:string;
    let loginWarning='';
    if(input.tokenExpiresAt===null){
        tokenLine=input.consentMode==='production'
            ? 'No fixed expiry (production mode)'
            : 'Unknown';
    } else {
        tokenLine=input.tokenExpiresAt.toUTCString();
        if(input.tokenExpiresAt.getTime()<=now.getTime())
            loginWarning=`\nWarning: login has expired.\nRun /start to re-link the mailbox`;
        else if(input.tokenExpiresAt.getTime()-now.getTime()<LOGIN_EXPIRY_WARNING_MS)
            loginWarning=`\nWarning: login expires soon (${input.tokenExpiresAt.toUTCString()}).\nRun /start to renew it`;
    }
    const watchWarning=input.watchExpiration!==null&&input.watchExpiration.getTime()<=now.getTime()
        ? `\nWarning: tracking (watch) has expired; new-mail updates may be missing.\nIt is renewed automatically, or run /start to re-link`
        : '';
    const freshness=input.lastDeliveredAt===null
        ? '\nLast notification: none delivered yet'
        : `\nLast notification: ${input.lastDeliveredAt.toUTCString()}`;
    return `Email:${input.email}\nWatch expiration:${watchExpiration} UTC\nToken Expiration:${tokenLine}${input.tokenExpiresAt===null?'':' UTC'}${warning}${unreadable}${loginWarning}${watchWarning}${blocked}${delivery}${freshness}`;
}
