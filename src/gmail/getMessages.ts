import { gmail } from ".";
import { isFromRabotaBy } from "./isFromRabotaBy";
import { messageBodyToText } from "./messageBody";
import { parseMessageFields } from "./parseMessageFields";

export interface MessageWithText {
    id: string;
    text: string | null;
    subject: string;
}

async function validateMessages(messageIds: string[], email: string): Promise<string[]> {
    const validMessageIds: string[] = [];
    for (const id of messageIds) {
        const response = await gmail.users.messages.get({
            format: "metadata",
            metadataHeaders: ["From", "Subject"],
            id,
            userId: email
        });
        const headers = response.data.payload?.headers ?? [];
        const fromHeader = headers.find(header => header.name?.toLowerCase() === "from");
        if (fromHeader?.value && isFromRabotaBy(fromHeader.value))
            validMessageIds.push(id);
    }
    return validMessageIds;
}

async function getMessages(messageIds: string[], email: string): Promise<MessageWithText[]> {
    const validMessageIds=await validateMessages(messageIds,email);

    const messages: MessageWithText[] = [];
    for (const id of validMessageIds) {
        const response = await gmail.users.messages.get({
            format: "full",
            id,
            userId: email
        });
        const subject=response.data.payload?.headers?.find(header => header.name?.toLowerCase() === "subject")?.value ?? 'Unknown';
        messages.push({ id, text: messageBodyToText(response.data.payload),subject });
    }
    return messages;
}

export interface MessageData {
    gmailMessageId: string;
    subject: string;
    vacancy: string | null;
    employer: string | null;
    outcome: string | null;
}

export async function getDataFromMessages(messageIds: string[], email: string): Promise<MessageData[]> {
    const messages = await getMessages(messageIds, email);

    return messages.map(message => ({
        gmailMessageId: message.id,
        subject: message.subject,
        ...parseMessageFields(message.text, message.subject)
    }));
}