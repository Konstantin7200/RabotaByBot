import { startHandler } from "./startHandler";
import { unlinkHandler } from "./unlinkHandler";
import { statusHandler } from "./statusHandler";
import { getBot } from ".";


export async function loadHandlers(){
    const bot=getBot();

    bot.command('start',startHandler)
    
    bot.command('unlink',unlinkHandler)
    
    bot.command('status',statusHandler)

    bot.start();
}