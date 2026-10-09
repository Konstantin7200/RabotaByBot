import { beforeEach, describe, expect, it, vi } from "vitest";

type Capture = {
    updated: boolean;
    selectedBasis: string | null;
    selectedRow: Record<string, unknown> | null;
    inserted: Record<string, unknown> | null;
};
const captured: Capture = { updated: false, selectedBasis: null, selectedRow: null, inserted: null };

vi.mock("./index", () => {
    const updateChain = {
        set() {
            return updateChain;
        },
        where() {
            captured.updated = true;
            return Promise.resolve([]);
        },
    };
    const limitable = {
        async limit() {
            if (captured.selectedRow !== null)
                return [captured.selectedRow];
            return captured.selectedBasis === null ? [] : [{ basis: captured.selectedBasis }];
        },
    };
    const selectChain = {
        from() {
            return {
                where() {
                    return limitable;
                },
            };
        },
    };
    const insertChain = {
        values(value: Record<string, unknown>) {
            captured.inserted = value;
            return {
                async onConflictDoUpdate(args: { set: Record<string, unknown> }) {
                    captured.inserted = { ...value, ...args.set };
                },
            };
        },
    };
    return {
        db: {
            update: () => updateChain,
            select: () => selectChain,
            insert: () => insertChain,
        },
    };
});

import { advanceBasis, createMailbox, getMailbox } from "./mailboxRepository";
import { encryptSecret } from "./secretBox";

const KEY = "c".repeat(64);

beforeEach(() => {
    captured.updated = false;
    captured.selectedBasis = null;
    captured.selectedRow = null;
    captured.inserted = null;
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
});

describe("advanceBasis monotonicity (FR-3)", () => {
    it("advances when the new history id is newer", async () => {
        captured.selectedBasis = "90";
        await expect(advanceBasis(1, "101")).resolves.toBe(true);
        expect(captured.updated).toBe(true);
    });

    it("skips the write when an out-of-order push would move the basis backwards", async () => {
        captured.selectedBasis = "101";
        await expect(advanceBasis(1, "90")).resolves.toBe(false);
        expect(captured.updated).toBe(false);
    });

    it("skips the write when the new history id equals the current basis", async () => {
        captured.selectedBasis = "101";
        await expect(advanceBasis(1, "101")).resolves.toBe(false);
        expect(captured.updated).toBe(false);
    });

    it("advances when no basis is stored yet", async () => {
        captured.selectedBasis = null;
        await expect(advanceBasis(1, "101")).resolves.toBe(true);
        expect(captured.updated).toBe(true);
    });

    it("treats non-numeric history ids as opaque and always advances", async () => {
        captured.selectedBasis = "opaque-a";
        await expect(advanceBasis(1, "opaque-b")).resolves.toBe(true);
        expect(captured.updated).toBe(true);
    });
});

describe("refresh token encryption at rest (NFR)", () => {
    it("createMailbox stores the token encrypted, never in plaintext", async () => {
        await createMailbox({ id: 1, userId: 2, email: "a@b.c", refreshToken: "plain-token" } as never);
        const stored = captured.inserted?.refreshToken as string;
        expect(stored.startsWith("v1:")).toBe(true);
        expect(stored).not.toContain("plain-token");
    });

    it("getMailbox decrypts the stored token before handing it out", async () => {
        captured.selectedRow = {
            id: 1,
            email: "a@b.c",
            refreshToken: encryptSecret("plain-token"),
        };
        const mailbox = await getMailbox("a@b.c");
        expect(mailbox?.refreshToken).toBe("plain-token");
    });

    it("getMailbox reports a null token for undecryptable (legacy plaintext) rows", async () => {
        captured.selectedRow = {
            id: 1,
            email: "a@b.c",
            refreshToken: "legacy-plaintext",
        };
        const mailbox = await getMailbox("a@b.c");
        expect(mailbox?.refreshToken).toBeNull();
    });
});
