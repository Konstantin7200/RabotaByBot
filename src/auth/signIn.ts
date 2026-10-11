import { randomBytes } from "node:crypto";
import { auth } from ".";
import { createKey } from "../db/oauthKeysRepository";

const STATE_TTL_MS=10*60*1000;

export async function getAuthUrl(id:number){
    const scopes=[
        'openid',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/gmail.readonly'
    ];
    const state=randomBytes(16).toString('hex');
    await createKey({
        key:state,
        chatId:String(id),
        expiresAt:new Date(Date.now()+STATE_TTL_MS)
    });
    const generatedAuthUrl=auth.generateAuthUrl({
        scope:scopes,
        prompt:'consent',
        access_type:'offline',
        state:state
    })
    return generatedAuthUrl;
}
