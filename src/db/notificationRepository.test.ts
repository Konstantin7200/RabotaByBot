import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

type Capture = { where: unknown; set: Record<string, unknown> | null };
const captured: Capture = { where: null, set: null };

vi.mock("./index", () => {
    const updateChain = {
        set(values: Record<string, unknown>) {
            captured.set = values;
            return updateChain;
        },
        where(expr: unknown) {
            captured.where = expr;
            return updateChain;
        },
        async returning() {
            return [];
        },
    };
    const selectChain = {
        from() {
            return {
                async where(expr: unknown) {
                    captured.where = expr;
                    return [];
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

import { claimDueRetries, markStaleAsSent, replayFailed } from "./notificationRepository";

const dialect = new PgDialect();

function whereSql(): string {
    expect(captured.where).not.toBeNull();
    return dialect.sqlToQuery(captured.where as never).sql;
}

beforeEach(() => {
    captured.where = null;
    captured.set = null;
});

describe("FR-7/FR-11 staleness window (replay-aware)", () => {
    it("markStaleAsSent measures age from coalesce(replayedAt, createdAt) and stamps sentAt", async () => {
        const now = new Date("2026-01-01T00:10:00Z");
        await markStaleAsSent(now);
        const sqlText = whereSql();
        expect(sqlText).toContain("coalesce");
        expect(sqlText).toContain("replayedAt");
        expect(sqlText).toContain("createdAt");
        expect(captured.set).toMatchObject({ status: "sent", sentAt: now });
    });

    it("claimDueRetries only claims rows younger than the window measured since replay", async () => {
        await claimDueRetries(new Date("2026-01-01T00:10:00Z"));
        const sqlText = whereSql();
        expect(sqlText).toContain("coalesce");
        expect(sqlText).toContain("replayedAt");
    });

    it("replayFailed resets the row and stamps replayedAt so it can be claimed again", async () => {
        const now = new Date("2026-01-01T00:10:00Z");
        await replayFailed(now);
        expect(captured.set).toMatchObject({
            status: "pending",
            attempts: 0,
            nextAttemptAt: now,
            replayedAt: now,
        });
        expect(whereSql()).toContain("status");
    });
});
