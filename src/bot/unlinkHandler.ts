import { Context } from "grammy";
import { getByUserId } from "../db/mailboxRepository";
import { getByChatId } from "../db/userRepository";
import { untrackMailbox } from "../gmail/untrackMailbox";
import { MESSAGE_FOR_UNLINK_CONFIRMATION, REVOKED_SCOPES } from "../constants";

export async function unlinkHandler(ctx: Context) {
    const chatId = ctx.chatId;
    if (typeof chatId !== 'number')
        throw new Error('Chat id is null');

    const user = await getByChatId(chatId.toString());
    if (user === null) {
        return ctx.reply('You have not completed start yet');
    }
    const mailbox = await getByUserId(user.id);
    if (mailbox === null) {
        return ctx.reply('You have no currently connected mailbox');
    }
    await untrackMailbox(mailbox);
    ctx.reply(MESSAGE_FOR_UNLINK_CONFIRMATION(mailbox.email, REVOKED_SCOPES));
}
