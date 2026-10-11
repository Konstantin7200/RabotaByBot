import { parseAddressList } from "email-addresses";

// UNCONFIRMED: the sender domain is taken from the assignment (§6.3) and has
// not been verified against a real Rabota.by reply sample yet.
const NOTIFY_SENDER_DOMAIN = "rabota.by";

export function isFromRabotaBy(fromHeaderValue: string): boolean {
    const parsed = parseAddressList({ input: fromHeaderValue, rfc6532: true });
    if (!parsed || parsed.length === 0)
        return false;
    return parsed.every(entry => entry.type === "mailbox" && entry.domain.toLowerCase() === NOTIFY_SENDER_DOMAIN);
}
