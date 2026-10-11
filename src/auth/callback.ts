import { log } from "../logger";
import { Request,Response } from "express";
import { StatusCodes } from "http-status-codes";
import { join } from "path";
import { takeKey } from "../db/oauthKeysRepository";
import { getMailbox } from "../db/mailboxRepository";
import { catchUpMailbox } from "../gmail/catchUpMailbox";
import { linkMailbox } from "./linkMailbox";
import { notifyChat } from "./notifyChat";
import { MESSAGE_FOR_AUTH_CANCELLED,MESSAGE_FOR_AUTH_FAILED,PUBLIC_DIR } from "../constants";

function respondError(res:Response,status:number){
    res.status(status).sendFile(join(PUBLIC_DIR,"error.html"));
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
        // The mailbox-link flow (user upsert, token exchange, watch install,
        // transactional relink) lives in linkMailbox - this handler only
        // consumes the one-time state and renders the OAuth pages.
        const linked=await linkMailbox(key.chatId,code);
        res.status(StatusCodes.OK).sendFile(join(PUBLIC_DIR,"success.html"));
        if (linked.relinkedExisting)
            void getMailbox(linked.email)
                .then((m) => (m === null ? undefined : catchUpMailbox(m)))
                .catch((err) => log.error({ event: "catch_up_failed", email: linked.email, err: String(err) }));
    } catch(err){
        log.error({event:"oauth_callback_failed",chatId,err:String(err)});
        notifyChat(chatId,MESSAGE_FOR_AUTH_FAILED);
        respondError(res,StatusCodes.INTERNAL_SERVER_ERROR);
    }
}
