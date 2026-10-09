import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION_PREFIX = "v1:";

function getKeyBytes(): Buffer {
    const key = process.env.TOKEN_ENCRYPTION_KEY;
    if (typeof key !== "string" || !/^[0-9a-fA-F]{64}$/.test(key))
        throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
    return Buffer.from(key, "hex");
}

export function encryptSecret(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", getKeyBytes(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${VERSION_PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptSecret(stored: string): string {
    if (!stored.startsWith(VERSION_PREFIX))
        throw new Error("Unsupported secret format");
    const [ivB64, tagB64, dataB64] = stored.slice(VERSION_PREFIX.length).split(":");
    if (ivB64 === undefined || tagB64 === undefined || dataB64 === undefined)
        throw new Error("Malformed secret");
    const decipher = createDecipheriv("aes-256-gcm", getKeyBytes(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
}

export function decryptTokenOrNull(stored: string | null): string | null {
    if (stored === null)
        return null;
    try {
        return decryptSecret(stored);
    } catch {
        console.log({ event: "refresh_token_decrypt_failed" });
        return null;
    }
}
