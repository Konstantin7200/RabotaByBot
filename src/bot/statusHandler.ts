import { Context } from "grammy";

export function statusHandler(ctx:Context){
    console.log('Status');
    ctx.reply("Hi this is your status");
}