import { classifySendError } from "./classifySendError";
import { renderNotification } from "./renderNotification";
import { sendMessage } from "./sendMessage";
import { Notification } from "../db/entityTypes";
import { recordFailure, setNotificationDelivered } from "../db/notificationRepository";
import { getChatIdByMailboxId, setChatStatus } from "../db/userRepository";

export async function deliverNotification(notification: Notification): Promise<void> {
    const chatId = await getChatIdByMailboxId(notification.mailboxId);
    if (chatId === null) {
        await recordFailure(notification.id, "no chat for mailbox");
        return;
    }
    const message = renderNotification({
        vacancy: notification.vacancy,
        employer: notification.employer,
        outcome: notification.outcome,
        subject: notification.subject,
    });
    try {
        await sendMessage(parseInt(chatId, 10), message);
    }
    catch (err) {
        if (classifySendError(err) === "blocked")
            await setChatStatus(chatId, "blocked");
        await recordFailure(notification.id, String(err));
        return;
    }
    await setNotificationDelivered(notification.gmailMessageId, notification.mailboxId);
    await setChatStatus(chatId, "ok");
}
