import { beforeEach, describe, expect, it, vi } from "vitest";

type Capture = {
    updated: boolean;
    selectedBasis: string | null;
    selectedRow: Record<string, unknown> | null;
    inserted: Record<string, unknown> | null;
    selectWhere: unknown;
    updateRows: Record<string, unknown>[];
};
const captured: Capture = { updated: false, selectedBasis: null, selectedRow: null, inserted: null, selectWhere: null, updateRows: [] };

vi.mock("./index", () => {
    const updateChain = {
        set() {
            return updateChain;
        },
        where() {
            captured.updated = true;
            return {
                returning() {
                    return Promise.resolve(captured.updateRows);
                },
                then(
                    resolve: (value: unknown) => void,
                    reject: (reason: unknown) => void,
                ) {
                    Promise.resolve(captured.updateRows).then(resolve, reject);
                },
            };
        },
    };
    function rowsForSelect() {
        if (captured.selectedRow !== null)
            return [captured.selectedRow];
        return captured.selectedBasis === null ? [] : [{ basis: captured.selectedBasis }];
    }
    const limitable = {
        async limit() {
            return rowsForSelect();
        },
        then(
            resolve: (value: unknown) => void,
            reject: (reason: unknown) => void,
        ) {
            Promise.resolve(rowsForSelect()).then(resolve, reject);
        },
    };
    const selectChain = {
        from() {
            return {
                where(expr: unknown) {
                    captured.selectWhere = expr;
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

import { advanceBasis, claimFailureNotice, createMailbox, getMailbox, listDueForRenewal, listDueForTokenExpiryWarning, registerPipelineSuccess, registerTransientFailure } from "./mailboxRepository";
import { encryptSecret } from "./secretBox";
import { PgDialect } from "drizzle-orm/pg-core";

const KEY = "c".repeat(64);

beforeEach(() => {
    captured.updated = false;
    captured.selectedBasis = null;
    captured.selectedRow = null;
    captured.inserted = null;
    captured.selectWhere = null;
    captured.updateRows = [];
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

describe("listDueForRenewal (FR-10)", () => {
    it("includes the daily-renewal clause keyed on watchRenewedAt", async () => {
        await listDueForRenewal(new Date());
        const sqlText = new PgDialect().sqlToQuery(captured.selectWhere as never).sql;
        expect(sqlText).toContain("watchRenewedAt");
        expect(sqlText).toContain("watchExpiration");
    });
});

describe("token expiry warning candidates (US-8)", () => {
    it("only selects active mailboxes with an unwarmed grant", async () => {
        await listDueForTokenExpiryWarning();
        const sqlText = new PgDialect().sqlToQuery(captured.selectWhere as never).sql;
        expect(sqlText).toContain("tokenExpiryWarnedAt");
        expect(sqlText).toContain("tokenGrantedAt");
        expect(sqlText).toContain("accessStatus");
    });
});

describe("persistent failure tracking (US-9/US-10)", () => {
    it("registerTransientFailure returns the incremented counter", async () => {
        captured.updateRows = [{ value: 3 }];
        await expect(registerTransientFailure(7)).resolves.toBe(3);
        expect(captured.updated).toBe(true);
    });

    it("claimFailureNotice is granted only when no notice was sent yet", async () => {
        captured.updateRows = [{ value: 7 }];
        await expect(claimFailureNotice(7)).resolves.toBe(true);
        captured.updateRows = [];
        await expect(claimFailureNotice(7)).resolves.toBe(false);
    });

    it("registerPipelineSuccess reports owed only after a sent notice", async () => {
        captured.selectedRow = { notified: null, failures: 0 };
        await expect(registerPipelineSuccess(7)).resolves.toBe(false);
        expect(captured.updated).toBe(false);

        captured.selectedRow = { notified: null, failures: 2 };
        await expect(registerPipelineSuccess(7)).resolves.toBe(false);
        expect(captured.updated).toBe(true);

        captured.selectedRow = { notified: new Date(), failures: 3 };
        await expect(registerPipelineSuccess(7)).resolves.toBe(true);
        expect(captured.updated).toBe(true);
    });

    it("registerPipelineSuccess is a no-op for an unknown mailbox", async () => {
        captured.selectedRow = null;
        await expect(registerPipelineSuccess(7)).resolves.toBe(false);
        expect(captured.updated).toBe(false);
    });
});
