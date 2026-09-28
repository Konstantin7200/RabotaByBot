import { getBot } from ".";

export function sendMessage(chatId:number,message:string){
    const bot=getBot();

    bot.api.sendMessage(chatId,message);
}