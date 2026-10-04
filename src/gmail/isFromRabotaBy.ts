import { parseAddressList } from "email-addresses";

const NOTIFY_SENDER_DOMAIN = "rabota.by";

export function isFromRabotaBy(fromHeaderValue: string): boolean {
    const parsed = parseAddressList({ input: fromHeaderValue, rfc6532: true });
    if (!parsed || parsed.length === 0)
        return false;
    return parsed.every(entry => entry.type === "mailbox" && entry.domain.toLowerCase() === NOTIFY_SENDER_DOMAIN);
}
