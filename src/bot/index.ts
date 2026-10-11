import { Bot } from "grammy";
import { EnvConfig } from "../config";

let bot:Bot|null=null;
export function getBot(){
    if(bot!==null)
        return bot;
    bot=new Bot(EnvConfig.tgBotToken);
    return bot;
}