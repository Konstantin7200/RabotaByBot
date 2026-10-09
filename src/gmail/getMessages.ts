import { gmail_v1 } from "@googleapis/gmail";
import { EnvConfig } from "../config";
import { isFromRabotaBy } from "./isFromRabotaBy";
import { isResponseTemplate } from "./isResponseTemplate";
import { messageBodyToText } from "./messageBody";
import { parseMessageFields } from "./parseMessageFields";

export interface MessageWithText {
    id: string;
    text: string | null;
    subject: string;
    fromHeader: string | null;
}

async function validateMessages(gmail:gmail_v1.Gmail,messageIds: string[], email: string): Promise<string[]> {
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
        const subjectHeader = headers.find(header => header.name?.toLowerCase() === "subject");
        if (fromHeader?.value && isFromRabotaBy(fromHeader.value)
            && isResponseTemplate(subjectHeader?.value ?? "", EnvConfig.rabotaSubjectPatterns))
            validMessageIds.push(id);
    }
    return validMessageIds;
}

async function getMessages(gmail:gmail_v1.Gmail,messageIds: string[], email: string): Promise<MessageWithText[]> {
    const validMessageIds=await validateMessages(gmail,messageIds,email);

    const messages: MessageWithText[] = [];
    for (const id of validMessageIds) {
        const response = await gmail.users.messages.get({
            format: "full",
            id,
            userId: email
        });
        const subject=response.data.payload?.headers?.find(header => header.name?.toLowerCase() === "subject")?.value ?? 'Unknown';
        const from=response.data.payload?.headers?.find(header => header.name?.toLowerCase() === "from")?.value ?? null;
        messages.push({ id, text: messageBodyToText(response.data.payload),subject,fromHeader:from });
    }
    return messages;
}

export interface MessageData {
    gmailMessageId: string;
    subject: string;
    fromHeader: string | null;
    vacancy: string | null;
    employer: string | null;
    outcome: string | null;
}

export async function getDataFromMessages(gmail:gmail_v1.Gmail,messageIds: string[], email: string): Promise<MessageData[]> {
    const messages = await getMessages(gmail,messageIds, email);

    return messages.map(message => ({
        gmailMessageId: message.id,
        subject: message.subject,
        fromHeader: message.fromHeader,
        ...parseMessageFields(message.text, message.subject)
    }));
}