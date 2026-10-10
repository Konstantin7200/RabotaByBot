import { getChatIdByMailboxId } from "../db/userRepository";
import { sendWithRetry, SendRetryOptions } from "./sendWithRetry";

export async function notifyMailboxOwner(
    mailboxId: number,
    text: string,
    opts?: SendRetryOptions,
): Promise<boolean> {
    try {
        const chatId = await getChatIdByMailboxId(mailboxId);
        if (chatId === null)
            return false;
        await sendWithRetry(parseInt(chatId, 10), text, opts);
        return true;
    }
    catch (err) {
        console.log({ event: "owner_notify_failed", mailboxId, err: String(err) });
        return false;
    }
}
