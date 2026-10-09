import { beforeEach, describe, expect, it, vi } from "vitest";

type Capture = { updated: boolean; selectedBasis: string | null };
const captured: Capture = { updated: false, selectedBasis: null };

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
    const selectChain = {
        from() {
            return {
                where() {
                    return {
                        async limit() {
                            return captured.selectedBasis === null ? [] : [{ basis: captured.selectedBasis }];
                        },
                    };
                },
            };
        },
    };
    return {
        db: {
            update: () => updateChain,
            select: () => selectChain,
        },
    };
});

import { advanceBasis } from "./mailboxRepository";

beforeEach(() => {
    captured.updated = false;
    captured.selectedBasis = null;
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
