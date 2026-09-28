import { Bot } from "grammy";
import { EnvConfig } from "../config";
import { startHandler } from "./startHandler";
import { unlinkHandler } from "./unlinkHandler";
import { statusHandler } from "./statusHandler";


export async function loadHandlers(){
    const bot=new Bot(EnvConfig.tgBotToken);

    bot.command('start',startHandler)
    
    bot.command('unlink',unlinkHandler)
    
    bot.command('status',statusHandler)

    bot.start();
}