import { describe, expect, it, vi } from "vitest";

vi.mock("../db/mailboxRepository", () => ({ getMailboxByChatId: vi.fn() }));
vi.mock("../db/userRepository", () => ({ getByChatId: vi.fn() }));
vi.mock("../db/notificationRepository", () => ({ getRecentProblems: vi.fn() }));
vi.mock("./sendMessage", () => ({ sendMessage: vi.fn() }));
vi.mock("../config", () => ({
    EnvConfig: {
        googleConsentMode: "testing" as const,
        googleAuth: { clientId: "c", secret: "s", redirectUri: "r", topicName: "t" },
    },
}));

import { computeTokenExpiresAt, createStatusMessage } from "./statusHandler";
import { TOKEN_EXPIRE_MS } from "../constants";

const clean = { stuckCount: 0, lastFailure: null };
const watch = new Date("2026-10-15T12:00:00.000Z");
const NOW = new Date("2026-10-10T12:00:00.000Z");

function base(overrides: Partial<Parameters<typeof createStatusMessage>[0]> = {}) {
    return createStatusMessage({
        email: "a@b.c",
        accessStatus: "active",
        chatBlocked: false,
        problems: clean,
        watchExpiration: watch,
        tokenExpiresAt: new Date("2026-10-15T12:00:00.000Z"),
        consentMode: "testing",
        lastDeliveredAt: null,
        credentialsUnreadable: false,
        now: NOW,
        ...overrides,
    });
}

describe("createStatusMessage (FR-1, US-2)", () => {
    it("keeps the base status and existing access warning", () => {
        const msg = base();
        expect(msg).toContain("Email:a@b.c");
        expect(msg).not.toContain("Warning");
        expect(base({ accessStatus: "expired" }))
            .toContain("tracking is stopped (expired)");
    });

    it("warns when the login has already expired (FR-1)", () => {
        const msg = base({ tokenExpiresAt: new Date("2026-10-10T00:00:00.000Z") });
        expect(msg).toContain("login has expired");
        expect(msg).toContain("/start");
    });

    it("warns when the login expires within a day (US-8)", () => {
        const msg = base({ tokenExpiresAt: new Date(NOW.getTime() + 60*60*1000) });
        expect(msg).toContain("login expires soon");
    });

    it("warns when the watch has expired (FR-1)", () => {
        const msg = base({ watchExpiration: new Date("2026-10-01T00:00:00.000Z") });
        expect(msg).toContain("watch) has expired");
    });

    it("shows no fixed expiry in production mode", () => {
        const msg = base({ tokenExpiresAt: null, consentMode: "production" });
        expect(msg).toContain("No fixed expiry (production mode)");
    });

    it("surfaces the last delivered notification for freshness (US-2)", () => {
        expect(base()).toContain("none delivered yet");
        expect(base({ lastDeliveredAt: new Date("2026-10-09T08:00:00.000Z") }))
            .toContain(`Last notification: ${new Date("2026-10-09T08:00:00.000Z").toUTCString()}`);
    });

    it("warns when the stored login can no longer be read (WP4 fresh start)", () => {
        const msg = base({ credentialsUnreadable: true });
        expect(msg).toContain("stored login can no longer be read");
        expect(msg).toContain("/start");
    });

    it("warns when the bot is blocked in the chat (FR-11)", () => {
        expect(base({ chatBlocked: true })).toContain("blocked");
    });

    it("warns about undelivered notifications with the last error (FR-11/US-2)", () => {
        const msg = base({
            problems: { stuckCount: 2, lastFailure: { lastError: "Forbidden: bot was blocked", attempts: 5 } },
        });
        expect(msg).toContain("2 notification(s)");
        expect(msg).toContain("Forbidden: bot was blocked");
    });

    it("shows only the last error, without a count, when nothing is stuck (FR-11)", () => {
        const msg = base({
            problems: { stuckCount: 0, lastFailure: { lastError: "Forbidden: bot was blocked", attempts: 5 } },
        });
        expect(msg).toContain("delivery problems");
        expect(msg).toContain("last error after 5 attempt(s): Forbidden: bot was blocked");
        expect(msg).not.toContain("notification(s) not delivered yet");
    });

    it("shows no delivery warning when everything is healthy", () => {
        expect(base()).not.toContain("delivery problems");
    });
});

describe("computeTokenExpiresAt (consent mode, FR-1)", () => {
    it("adds the 7-day testing window to the grant time", () => {
        const granted = new Date("2026-10-01T00:00:00.000Z");
        expect(computeTokenExpiresAt(granted)?.getTime()).toBe(granted.getTime() + TOKEN_EXPIRE_MS);
    });

    it("returns null in production mode (no fixed expiry)", () => {
        expect(computeTokenExpiresAt(new Date(), "production")).toBeNull();
    });

    it("returns null without a grant time", () => {
        expect(computeTokenExpiresAt(null)).toBeNull();
    });
});
