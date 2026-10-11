import { startHandler } from "./startHandler";
import { unlinkHandler } from "./unlinkHandler";
import { statusHandler } from "./statusHandler";
import { getBot } from ".";
import { CMD } from "../constants";

export function loadHandlers(){
    const bot=getBot();

    bot.command(CMD.START,startHandler)

    bot.command(CMD.UNLINK,unlinkHandler)

    bot.command(CMD.STATUS,statusHandler)
}
