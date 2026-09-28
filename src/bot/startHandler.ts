import { Context } from "grammy";
import { getAuthUrl } from "../auth/signIn";

export function startHandler(ctx:Context){
    const id=ctx.chatId;
    if(id===undefined)
        throw new Error(`Id is undefined ctx=${ctx}`);
    const url=getAuthUrl(id);
    ctx.reply(`Hi,please login /n ${url}`);
}