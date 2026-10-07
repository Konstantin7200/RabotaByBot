import { Request,Response } from "express";
import { auth } from ".";
import { EnvConfig } from "../config";
import { getTokens } from "./getTokens";
import { takeKey } from "../db/oauthKeysRepository";
import { createIfNotExists, getByChatId, getChatIdByUserId } from "../db/userRepository";
import { InsertedMailbox, InsertedUser, MailboxesTable } from "../db/entityTypes";
import { createMailbox, getByUserId, getMailbox } from "../db/mailboxRepository";
import { watch } from "../gmail/watch";
import { untrackMailbox } from "../gmail/untrackMailbox";
import { sendMessage } from "../bot/sendMessage";
import { createReplacedMailboxMessage, MESSAGE_MAILBOX_RELINKED } from "../constants";

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

export async function callback(req:Request,res:Response){
    const state=req.query['state'];
    if(typeof state!=='string')
        throw new Error("State isnt string");
    const key=await takeKey(state);
    if(key===null)
        throw new Error('State not found in storage');
    const chatId=key.chatId;
    const numChatId=parseInt(chatId,10);
    const userToCreate:InsertedUser={
        chatId,
        chatStatus:'ok',
    }
    await createIfNotExists(userToCreate);
    const code=req.query['code']
    if(typeof code!=='string')
        throw new Error("Code isnt a string");
    const tokens=await getTokens(code);
    const user=await getByChatId(chatId);
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
    const previousChatId=existing!==null&&existing.userId!==null
        ? await getChatIdByUserId(existing.userId)
        : null;
    const oldMailbox=await getByUserId(user.id);
    if(oldMailbox!==null&&oldMailbox.email!==email)
        await unlinkReplacedMailbox(oldMailbox,email,numChatId);
    const mailboxToCreate:InsertedMailbox={
        userId:user.id,
        email,
        refreshToken:tokens.refreshToken
    };
    await createMailbox(mailboxToCreate);
    if(previousChatId!==null&&Number(previousChatId)!==numChatId)
        await notifyPreviousOwner(Number(previousChatId),email);
    await watch(email,tokens.refreshToken,tokens.accessToken);
    res.send("Ok");
    sendMessage(numChatId,"You were successfully logged in");
    return [tokens]
}
