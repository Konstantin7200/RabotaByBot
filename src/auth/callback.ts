import { Request,Response } from "express";
import { auth } from ".";
import { EnvConfig } from "../config";
import { getTokens } from "./getTokens";
import { takeKey } from "../db/oauthKeysRepository";
import { createIfNotExists, getByChatId } from "../db/userRepository";
import { InsertedMailbox, InsertedUser } from "../db/entityTypes";
import { createMailbox } from "../db/mailboxRepository";
import { watch } from "../gmail/watch";

export async function callback(req:Request,res:Response){
    const state=req.query['state'];
    if(typeof state!=='string')
        throw new Error("State isnt string");
    const key=await takeKey(state);
    if(key===null)
        throw new Error('State not found in storage');
    const userToCreate:InsertedUser={
        chatId:key.chatId,
        chatStatus:'ok',
    }
    await createIfNotExists(userToCreate);
    const code=req.query['code']
    if(typeof code!=='string')
        throw new Error('Code isnt a string');
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
    const mailboxToCreate:InsertedMailbox={
        userId:user.id,
        email,
        refreshToken:tokens.refreshToken
    };
    await createMailbox(mailboxToCreate);
    await watch(email,tokens.refreshToken,tokens.accessToken);
    res.send("Ok");
    return [tokens]
}