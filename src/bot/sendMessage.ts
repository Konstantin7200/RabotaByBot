import { getBot } from ".";

export function sendMessage(chatId:number,message:string){
    const bot=getBot();

    return bot.api.sendMessage(chatId,message);
}