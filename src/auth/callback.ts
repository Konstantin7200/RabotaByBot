import { Request,Response } from "express";
import { join } from "path";
import { auth } from ".";
import { EnvConfig } from "../config";
import { getTokens } from "./getTokens";
import { takeKey } from "../db/oauthKeysRepository";
import { createIfNotExists, getByChatId, getChatIdByUserId } from "../db/userRepository";
import { InsertedMailbox, InsertedUser, MailboxesTable } from "../db/entityTypes";
import { createMailbox, getByUserId, getMailbox } from "../db/mailboxRepository";
import { watch } from "../gmail/watch";
import { catchUpMailbox } from "../gmail/catchUpMailbox";
import { untrackMailbox } from "../gmail/untrackMailbox";
import { sendMessage } from "../bot/sendMessage";
import {
    chooseLoginMessage,
    createReplacedMailboxMessage,
    MESSAGE_MAILBOX_RELINKED,
    MESSAGE_FOR_AUTH_CANCELLED,
    MESSAGE_FOR_AUTH_FAILED,
    PUBLIC_DIR
} from "../constants";

async function unlinkReplacedMailbox(oldMailbox:MailboxesTable,newEmail:string,chatId:number){
    await untrackMailbox(oldMailbox);
    try{
        await sendMessage(chatId,createReplacedMailboxMessage(oldMailbox.email,newEmail));
    } catch(err){
        console.log(err);
    }
}

async function notifyPreviousOwner(oldChatId:number,email:string){
    try{
        await sendMessage(oldChatId,MESSAGE_MAILBOX_RELINKED(email));
    } catch(err){
        console.log(err);
    }
}

function respondError(res:Response,status:number){
    res.status(status).sendFile(join(PUBLIC_DIR,"error.html"));
}

function notifyChat(chatId:number|null,text:string){
    if(chatId===null)
        return;
    try{
        sendMessage(chatId,text).catch((err)=>console.log(err));
    } catch(err){
        console.log(err);
    }
}

export async function callback(req:Request,res:Response){
    let chatId:number|null=null;
    try{
        const state=req.query['state'];
        if(typeof state!=='string'){
            respondError(res,400);
            return;
        }
        const key=await takeKey(state);
        if(key===null){
            respondError(res,400);
            return;
        }
        chatId=parseInt(key.chatId,10);
        if(typeof req.query['error']==='string'){
            notifyChat(chatId,MESSAGE_FOR_AUTH_CANCELLED);
            respondError(res,400);
            return;
        }
        const code=req.query['code'];
        if(typeof code!=='string'){
            respondError(res,400);
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
        if(oldMailbox!==null&&oldMailbox.email!==email)
            await unlinkReplacedMailbox(oldMailbox,email,chatId);
        const mailboxToCreate:InsertedMailbox={
            userId:user.id,
            email,
            refreshToken:tokens.refreshToken
        };
        await createMailbox(mailboxToCreate);
        if(previousChatId!==null&&Number(previousChatId)!==chatId)
            await notifyPreviousOwner(Number(previousChatId),email);
        await watch(email,tokens.refreshToken,tokens.accessToken);
        notifyChat(chatId,chooseLoginMessage(email,previousStatus));
        res.status(200).sendFile(join(PUBLIC_DIR,"success.html"));
        if (existing !== null && existing.historyIdBasis !== null)
            void getMailbox(email)
                .then((m) => (m === null ? undefined : catchUpMailbox(m)))
                .catch((err) => console.log({ event: "catch_up_failed", email, err: String(err) }));
        return [tokens]
    } catch(err){
        console.log(err);
        notifyChat(chatId,MESSAGE_FOR_AUTH_FAILED);
        respondError(res,500);
    }
}
