import { describe, expect, it } from "vitest";
import { decryptSecret, decryptTokenOrNull, encryptSecret } from "./secretBox";

const KEY = "a".repeat(64);

function withKey<T>(fn: () => T): T {
    const previous = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    try {
        return fn();
    } finally {
        if (previous === undefined)
            delete process.env.TOKEN_ENCRYPTION_KEY;
        else
            process.env.TOKEN_ENCRYPTION_KEY = previous;
    }
}

describe("secretBox (AES-256-GCM)", () => {
    it("round-trips a token", () => {
        withKey(() => {
            const stored = encryptSecret("refresh-token-value");
            expect(stored.startsWith("v1:")).toBe(true);
            expect(stored).not.toContain("refresh-token-value");
            expect(decryptSecret(stored)).toBe("refresh-token-value");
        });
    });

    it("produces a different ciphertext per call (random IV)", () => {
        withKey(() => {
            expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
        });
    });

    it("rejects a tampered ciphertext", () => {
        withKey(() => {
            const stored = encryptSecret("refresh-token-value");
            const [prefix, iv, tag, data] = stored.split(":");
            const flipped = data[0] === "A" ? "B" : "A";
            expect(() => decryptSecret([prefix, iv, tag, flipped + data.slice(1)].join(":"))).toThrow();
        });
    });

    it("rejects a stored value without the version prefix", () => {
        withKey(() => {
            expect(() => decryptSecret("plaintext-token")).toThrow("Unsupported secret format");
        });
    });

    it("decryptTokenOrNull returns null for undecryptable values instead of throwing", () => {
        withKey(() => {
            expect(decryptTokenOrNull(null)).toBeNull();
            expect(decryptTokenOrNull("plaintext-old-value")).toBeNull();
        });
    });

    it("throws when the encryption key is missing or malformed", () => {
        const previous = process.env.TOKEN_ENCRYPTION_KEY;
        delete process.env.TOKEN_ENCRYPTION_KEY;
        try {
            expect(() => encryptSecret("x")).toThrow("TOKEN_ENCRYPTION_KEY");
            process.env.TOKEN_ENCRYPTION_KEY = "short";
            expect(() => encryptSecret("x")).toThrow("TOKEN_ENCRYPTION_KEY");
        } finally {
            if (previous === undefined)
                delete process.env.TOKEN_ENCRYPTION_KEY;
            else
                process.env.TOKEN_ENCRYPTION_KEY = previous;
        }
    });
});
