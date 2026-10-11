import { sendMessage } from "../bot/sendMessage";

export function notifyChat(chatId:number|null,text:string){
    if(chatId===null)
        return;
    try{
        sendMessage(chatId,text).catch((err)=>console.log({event:"notify_chat_failed",err:String(err)}));
    } catch(err){
        console.log({event:"notify_chat_failed",err:String(err)});
    }
}
