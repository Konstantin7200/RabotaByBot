import { beforeEach, describe, expect, it, vi } from "vitest";

const consent = vi.hoisted(() => ({ mode: "testing" as "testing" | "production" }));

vi.mock("../../config", () => ({
    EnvConfig: {
        get googleConsentMode() { return consent.mode; },
        googleAuth: { clientId: "c", secret: "s", redirectUri: "r", topicName: "t" },
    },
}));
vi.mock("../../db/mailboxRepository", () => ({
    listDueForTokenExpiryWarning: vi.fn(),
    markTokenExpiryWarned: vi.fn(),
}));
vi.mock("../../bot/notifyMailboxOwner", () => ({ notifyMailboxOwner: vi.fn() }));

import { warnTokenExpiry } from "./warnTokenExpiry";
import { listDueForTokenExpiryWarning, markTokenExpiryWarned } from "../../db/mailboxRepository";
import { notifyMailboxOwner } from "../../bot/notifyMailboxOwner";
import { MESSAGE_LOGIN_EXPIRING_SOON, TOKEN_EXPIRE_MS } from "../../constants";

const granted = (msAgo: number) => new Date(Date.now() - msAgo);
const mailbox = (id: number, tokenGrantedAt: Date | null) =>
    ({ id, email: `u${id}@b.c`, tokenGrantedAt }) as never;

beforeEach(() => {
    vi.clearAllMocks();
    consent.mode = "testing";
    vi.mocked(listDueForTokenExpiryWarning).mockResolvedValue([]);
    vi.mocked(notifyMailboxOwner).mockResolvedValue(true);
});

describe("warnTokenExpiry (US-8)", () => {
    it("warns once when the login expires within 24 hours", async () => {
        vi.mocked(listDueForTokenExpiryWarning).mockResolvedValue([
            mailbox(1, granted(TOKEN_EXPIRE_MS - 60 * 60 * 1000)),
        ]);
        await warnTokenExpiry();
        expect(markTokenExpiryWarned).toHaveBeenCalledWith(1);
        expect(notifyMailboxOwner).toHaveBeenCalledTimes(1);
        const expected = new Date(granted(TOKEN_EXPIRE_MS - 60 * 60 * 1000).getTime() + TOKEN_EXPIRE_MS);
        expect(notifyMailboxOwner).toHaveBeenCalledWith(1, MESSAGE_LOGIN_EXPIRING_SOON("u1@b.c", expected));
    });

    it("stays silent while the login is fresh", async () => {
        vi.mocked(listDueForTokenExpiryWarning).mockResolvedValue([
            mailbox(1, granted(60 * 60 * 1000)),
        ]);
        await warnTokenExpiry();
        expect(markTokenExpiryWarned).not.toHaveBeenCalled();
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
    });

    it("stays silent when the login already expired (handled by renewals)", async () => {
        vi.mocked(listDueForTokenExpiryWarning).mockResolvedValue([
            mailbox(1, granted(TOKEN_EXPIRE_MS + 60 * 60 * 1000)),
        ]);
        await warnTokenExpiry();
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
    });

    it("skips mailboxes without a grant time", async () => {
        vi.mocked(listDueForTokenExpiryWarning).mockResolvedValue([mailbox(1, null)]);
        await warnTokenExpiry();
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
    });

    it("marks the grant as warned only after the message was actually sent", async () => {
        vi.mocked(listDueForTokenExpiryWarning).mockResolvedValue([
            mailbox(1, granted(TOKEN_EXPIRE_MS - 60 * 60 * 1000)),
        ]);
        vi.mocked(notifyMailboxOwner).mockResolvedValue(false);
        await warnTokenExpiry();
        expect(notifyMailboxOwner).toHaveBeenCalledTimes(1);
        expect(markTokenExpiryWarned).not.toHaveBeenCalled();
    });

    it("does nothing at all in production consent mode", async () => {
        consent.mode = "production";
        vi.mocked(listDueForTokenExpiryWarning).mockResolvedValue([
            mailbox(1, granted(TOKEN_EXPIRE_MS - 60 * 60 * 1000)),
        ]);
        await warnTokenExpiry();
        expect(listDueForTokenExpiryWarning).not.toHaveBeenCalled();
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
    });
});
