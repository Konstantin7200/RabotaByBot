import { describe, expect, it } from "vitest";
import {
    BACKOFF_MULT,
    BACKOFF_VALUE_MS,
    chooseLoginMessage,
    INLINE_DELIVERY_BUDGET_MS,
    MAX_NOTIFICATION_ATTEMPTS,
    MESSAGE_ACCESS_RESTORED,
    MESSAGE_LOGIN_SUCCESS,
    STALE_PENDING_MS,
} from "./constants";

describe("chooseLoginMessage", () => {
    it("reports recovery when the mailbox had a failure status", () => {
        for (const status of ["expired", "revoked", "error"])
            expect(chooseLoginMessage("u@b.c", status)).toBe(MESSAGE_ACCESS_RESTORED("u@b.c"));
    });
    it("keeps the generic login message for healthy, unlinked, or new mailboxes and includes the email", () => {
        for (const status of ["active", "unlinked", null]) {
            expect(chooseLoginMessage("u@b.c", status)).toBe(MESSAGE_LOGIN_SUCCESS("u@b.c"));
            expect(chooseLoginMessage("u@b.c", status)).toContain("u@b.c");
        }
    });
});

describe("STALE_PENDING_MS (FR-7)", () => {
    it("covers a full restart without losing undelivered rows", () => {
        // A redeploy/restart must deliver, not sweep: the recovery-time rule
        // may only kick in for genuinely abandoned rows.
        expect(STALE_PENDING_MS).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
    });
    it("stays above the full retry schedule plus the inline delivery budget", () => {
        const fullSchedule = Array.from({ length: MAX_NOTIFICATION_ATTEMPTS }, (_, i) =>
            BACKOFF_VALUE_MS * Math.pow(BACKOFF_MULT, i)).reduce((a, b) => a + b, 0);
        expect(STALE_PENDING_MS).toBeGreaterThan(fullSchedule + INLINE_DELIVERY_BUDGET_MS);
    });
});
