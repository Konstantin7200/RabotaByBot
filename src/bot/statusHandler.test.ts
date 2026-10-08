import { describe, expect, it, vi } from "vitest";

vi.mock("../db/mailboxRepository", () => ({ getMailboxByChatId: vi.fn() }));
vi.mock("../db/userRepository", () => ({ getByChatId: vi.fn() }));
vi.mock("../db/notificationRepository", () => ({ getRecentProblems: vi.fn() }));
vi.mock("./sendMessage", () => ({ sendMessage: vi.fn() }));

import { createStatusMessage } from "./statusHandler";

const clean = { stuckCount: 0, lastFailure: null };
const base = ("2026-10-15T12:00:00.000Z");

describe("createStatusMessage", () => {
    it("keeps the base status and existing access warning", () => {
        const msg = createStatusMessage(base, "a@b.c", base, "active", false, clean);
        expect(msg).toContain("Email:a@b.c");
        expect(msg).not.toContain("Warning");
        expect(createStatusMessage(base, "a@b.c", base, "expired", false, clean))
            .toContain("tracking is stopped (expired)");
    });
    it("warns when the bot is blocked in the chat (FR-11)", () => {
        expect(createStatusMessage(base, "a@b.c", base, "active", true, clean))
            .toContain("blocked");
    });
    it("warns about undelivered notifications with the last error (FR-11/US-2)", () => {
        const msg = createStatusMessage(base, "a@b.c", base, "active", false,
            { stuckCount: 2, lastFailure: { lastError: "Forbidden: bot was blocked", attempts: 5 } });
        expect(msg).toContain("2 notification(s)");
        expect(msg).toContain("Forbidden: bot was blocked");
    });
    it("shows only the last error, without a count, when nothing is stuck (FR-11)", () => {
        const msg = createStatusMessage(base, "a@b.c", base, "active", false,
            { stuckCount: 0, lastFailure: { lastError: "Forbidden: bot was blocked", attempts: 5 } });
        expect(msg).toContain("delivery problems");
        expect(msg).toContain("last error after 5 attempt(s): Forbidden: bot was blocked");
        expect(msg).not.toContain("notification(s) not delivered yet");
    });
    it("shows no delivery warning when everything is healthy", () => {
        expect(createStatusMessage(base, "a@b.c", base, "active", false, clean))
            .not.toContain("delivery problems");
    });
});
