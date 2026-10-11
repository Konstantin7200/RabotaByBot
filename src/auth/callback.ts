import { Request,Response } from "express";
import { StatusCodes } from "http-status-codes";
import { join } from "path";
import { auth } from ".";
import { EnvConfig } from "../config";
import { getTokens } from "./getTokens";
import { takeKey } from "../db/oauthKeysRepository";
import { createIfNotExists, getByChatId, getChatIdByUserId } from "../db/userRepository";
import { InsertedMailbox, InsertedUser, MailboxesTable } from "../db/entityTypes";
import { getByUserId, getMailbox, linkMailboxAtomically } from "../db/mailboxRepository";
import { installWatch } from "../gmail/watch";
import { catchUpMailbox } from "../gmail/catchUpMailbox";
import { remoteUntrack } from "../gmail/untrackMailbox";
import { sendMessage } from "../bot/sendMessage";
import {
    chooseLoginMessage,
    createReplacedMailboxMessage,
    MESSAGE_MAILBOX_RELINKED,
    MESSAGE_FOR_AUTH_CANCELLED,
    MESSAGE_FOR_AUTH_FAILED,
    PUBLIC_DIR
} from "../constants";

async function cleanupReplacedMailbox(oldMailbox:MailboxesTable,newEmail:string,chatId:number){
    const result=await remoteUntrack(oldMailbox);
    if(!result.stopped||!result.revoked)
        console.log({event:"replaced_unlink_incomplete",email:oldMailbox.email,stopped:result.stopped,revoked:result.revoked});
    try{
        await sendMessage(chatId,createReplacedMailboxMessage(oldMailbox.email,newEmail));
    } catch(err){
        console.log({event:"notify_replaced_mailbox_failed",err:String(err)});
    }
}

async function notifyPreviousOwner(oldChatId:number,email:string){
    try{
        await sendMessage(oldChatId,MESSAGE_MAILBOX_RELINKED(email));
    } catch(err){
        console.log({event:"notify_previous_owner_failed",err:String(err)});
    }
}

function respondError(res:Response,status:number){
    res.status(status).sendFile(join(PUBLIC_DIR,"error.html"));
}

function notifyChat(chatId:number|null,text:string){
    if(chatId===null)
        return;
    try{
        sendMessage(chatId,text).catch((err)=>console.log({event:"notify_chat_failed",err:String(err)}));
    } catch(err){
        console.log({event:"notify_chat_failed",err:String(err)});
    }
}

export async function callback(req:Request,res:Response){
    let chatId:number|null=null;
    try{
        const state=req.query['state'];
        if(typeof state!=='string'){
            respondError(res,StatusCodes.BAD_REQUEST);
            return;
        }
        const key=await takeKey(state);
        if(key===null){
            respondError(res,StatusCodes.BAD_REQUEST);
            return;
        }
        chatId=parseInt(key.chatId,10);
        if(typeof req.query['error']==='string'){
            notifyChat(chatId,MESSAGE_FOR_AUTH_CANCELLED);
            respondError(res,StatusCodes.BAD_REQUEST);
            return;
        }
        const code=req.query['code'];
        if(typeof code!=='string'){
            notifyChat(chatId,MESSAGE_FOR_AUTH_FAILED);
            respondError(res,StatusCodes.BAD_REQUEST);
            return;
        }
        const userToCreate:InsertedUser={
            chatId:key.chatId,
            chatStatus:'ok',
        }
        await createIfNotExists(userToCreate);
        const tokens=await getTokens(code);
        const user=await getByChatId(key.chatId);
        if(user===null)
            throw new Error('User not found');
        const ticket=await auth.verifyIdToken({
            idToken:tokens.idToken,
            audience:EnvConfig.googleAuth.clientId
        });
        const payload=ticket.getPayload();
        const email=payload?.email;
        if(typeof email!=='string')
            throw new Error('No email in id_token');
        const existing=await getMailbox(email);
        const previousStatus=existing!==null?existing.accessStatus:null;
        const previousChatId=existing!==null&&existing.userId!==null
            ? await getChatIdByUserId(existing.userId)
            : null;
        const oldMailbox=await getByUserId(user.id);
        // Install the watch before persisting anything: a failed watch must
        // leave the previous linkage untouched (US-1 CA3).
        const {historyId,expirationDate}=await installWatch(email,tokens.refreshToken,tokens.accessToken);
        const replacedUserId=oldMailbox!==null&&oldMailbox.email!==email?oldMailbox.userId:null;
        const mailboxToCreate:InsertedMailbox={
            userId:user.id,
            email,
            refreshToken:tokens.refreshToken
        };
        // Old-mailbox unlink, new-mailbox insert and the watch basis commit in
        // ONE transaction (FR-3/FR-15): a mid-flow failure can no longer leave
        // the old linkage destroyed with no new one, nor an active mailbox
        // without a watch. Remote cleanup and notices run after the commit.
        await linkMailboxAtomically(mailboxToCreate,{historyIdBasis:historyId,watchExpiration:expirationDate},replacedUserId);
        if(oldMailbox!==null&&oldMailbox.email!==email)
            await cleanupReplacedMailbox(oldMailbox,email,chatId);
        if(previousChatId!==null&&Number(previousChatId)!==chatId)
            await notifyPreviousOwner(Number(previousChatId),email);
        console.log({event:"oauth_linked",email});
        notifyChat(chatId,chooseLoginMessage(email,previousStatus));
        res.status(StatusCodes.OK).sendFile(join(PUBLIC_DIR,"success.html"));
        if (existing !== null && existing.historyIdBasis !== null)
            void getMailbox(email)
                .then((m) => (m === null ? undefined : catchUpMailbox(m)))
                .catch((err) => console.log({ event: "catch_up_failed", email, err: String(err) }));
        return [tokens]
    } catch(err){
        console.log({event:"oauth_callback_failed",chatId,err:String(err)});
        notifyChat(chatId,MESSAGE_FOR_AUTH_FAILED);
        respondError(res,StatusCodes.INTERNAL_SERVER_ERROR);
    }
}
