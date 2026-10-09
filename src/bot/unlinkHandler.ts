import { Context } from "grammy";
import { getByUserId } from "../db/mailboxRepository";
import { getByChatId } from "../db/userRepository";
import { untrackMailbox } from "../gmail/untrackMailbox";
import { MESSAGE_FOR_UNLINK_CONFIRMATION, MESSAGE_FOR_UNLINK_INCOMPLETE, REVOKED_SCOPES } from "../constants";

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
    const result = await untrackMailbox(mailbox);
    const failedSteps = [
        result.stopped ? null : "watch could not be stopped",
        result.revoked ? null : "access could not be revoked",
    ].filter((step): step is string => step !== null);
    if (failedSteps.length === 0)
        return ctx.reply(MESSAGE_FOR_UNLINK_CONFIRMATION(mailbox.email, REVOKED_SCOPES));
    return ctx.reply(MESSAGE_FOR_UNLINK_INCOMPLETE(mailbox.email, failedSteps.join(", ")));
}
