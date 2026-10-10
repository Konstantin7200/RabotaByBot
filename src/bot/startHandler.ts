import { Context } from "grammy";
import { getAuthUrl } from "../auth/signIn";

export async function startHandler(ctx:Context){
    const chatId=ctx.chatId;
    if(chatId===undefined)
        throw new Error(`Id is undefined ctx=${ctx}`);
    const url=await getAuthUrl(chatId);
    return ctx.reply(`Hi,please login\n${url}`);
}