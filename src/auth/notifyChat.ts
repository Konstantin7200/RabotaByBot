import { log } from "../logger";
import { sendMessage } from "../bot/sendMessage";

export function notifyChat(chatId:number|null,text:string){
    if(chatId===null)
        return;
    try{
        sendMessage(chatId,text).catch((err)=>log.error({event:"notify_chat_failed",err:String(err)}));
    } catch(err){
        log.error({event:"notify_chat_failed",err:String(err)});
    }
}
