import { getChatIdByMailboxId } from "../db/userRepository";
import { sendMessage } from "./sendMessage";

export async function notifyMailboxOwner(mailboxId: number, text: string): Promise<boolean> {
    try {
        const chatId = await getChatIdByMailboxId(mailboxId);
        if (chatId === null)
            return false;
        await sendMessage(parseInt(chatId, 10), text);
        return true;
    }
    catch (err) {
        console.log({ event: "owner_notify_failed", mailboxId, err: String(err) });
        return false;
    }
}
