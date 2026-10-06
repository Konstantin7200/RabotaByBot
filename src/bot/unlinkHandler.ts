import { Context } from "grammy";
import { unlinkMailbox } from "../db/mailboxRepository";
import { getByChatId } from "../db/userRepository";

export async function unlinkHandler(ctx:Context){
    const chatId=ctx.chatId;
    if(typeof chatId!=='number')
        throw new Error('Chat id is null');

    const user=await getByChatId(chatId.toString());
    if(user===null)
    {
        return ctx.reply('You have not completed start yet');
    }
    await unlinkMailbox(user?.id);
    ctx.reply("Your mailbox has been successfully unlinked");
}