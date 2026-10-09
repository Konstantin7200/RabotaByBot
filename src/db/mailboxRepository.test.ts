import { beforeEach, describe, expect, it, vi } from "vitest";

type Capture = {
    updated: boolean;
    selectedBasis: string | null;
    selectedRow: Record<string, unknown> | null;
    inserted: Record<string, unknown> | null;
    selectWhere: unknown;
    updateWhere: unknown;
    updateRows: Record<string, unknown>[];
};
const captured: Capture = { updated: false, selectedBasis: null, selectedRow: null, inserted: null, selectWhere: null, updateWhere: null, updateRows: [] };

vi.mock("./index", () => {
    const updateChain = {
        set() {
            return updateChain;
        },
        where(expr: unknown) {
            captured.updated = true;
            captured.updateWhere = expr;
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
    captured.updateWhere = null;
    captured.updateRows = [];
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
});

function updateWhereSql(): string {
    expect(captured.updateWhere).not.toBeNull();
    return new PgDialect().sqlToQuery(captured.updateWhere as never).sql;
}

describe("advanceBasis monotonicity (FR-3)", () => {
    it("guards numeric writes with one atomic conditional UPDATE", async () => {
        captured.updateRows = [{ value: 1 }];
        await expect(advanceBasis(1, "101")).resolves.toBe(true);
        const sqlText = updateWhereSql();
        expect(sqlText).toContain("historyIdBasis");
        expect(sqlText.toLowerCase()).toContain("is null");
        expect(sqlText).toContain("::bigint");
        expect(sqlText).toContain("!~");
    });

    it("reports false when the guard rejects an out-of-order write", async () => {
        captured.updateRows = [];
        await expect(advanceBasis(1, "90")).resolves.toBe(false);
        expect(captured.updated).toBe(true);
    });

    it("writes opaque (non-numeric) history ids unconditionally", async () => {
        captured.updateRows = [{ value: 1 }];
        await expect(advanceBasis(1, "opaque-b")).resolves.toBe(true);
        expect(updateWhereSql()).not.toContain("::bigint");
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

    it("registerPipelineSuccess claims the restore right atomically", async () => {
        captured.updateRows = [{ value: 7 }];
        await expect(registerPipelineSuccess(7)).resolves.toBe(true);
        expect(captured.updated).toBe(true);

        captured.updateRows = [];
        await expect(registerPipelineSuccess(7)).resolves.toBe(false);
    });

    it("registerPipelineSuccess always resets the failure counter", async () => {
        captured.updateRows = [];
        await registerPipelineSuccess(7);
        expect(captured.updated).toBe(true);
        expect(updateWhereSql()).toContain("consecutiveTransientFailures");
    });
});
