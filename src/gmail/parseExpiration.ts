export function parseExpiration(raw: string): Date {
    if (raw.trim() === "")
        throw new Error("Expiration is empty");
    const numeric = Number(raw);
    const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(raw);
    if (Number.isNaN(date.getTime()))
        throw new Error(`Invalid expiration value: ${raw}`);
    return date;
}
