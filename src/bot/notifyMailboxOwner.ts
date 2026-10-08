import { getChatIdByMailboxId } from "../db/userRepository";
import { sendMessage } from "./sendMessage";

export async function notifyMailboxOwner(mailboxId: number, text: string): Promise<void> {
    try {
        const chatId = await getChatIdByMailboxId(mailboxId);
        if (chatId === null)
            return;
        await sendMessage(parseInt(chatId, 10), text);
    }
    catch (err) {
        console.log(err);
    }
}
