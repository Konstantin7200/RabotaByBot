import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./sendMessage", () => ({ sendMessage: vi.fn() }));
vi.mock("../db/notificationRepository", () => ({ setNotificationDelivered: vi.fn(), recordFailure: vi.fn() }));
vi.mock("../db/userRepository", () => ({ getChatIdByMailboxId: vi.fn(), setChatStatus: vi.fn() }));
vi.mock("../db/mailboxRepository", () => ({ setLastDeliveredAt: vi.fn() }));

import { deliverNotification } from "./deliverNotification";
import { sendMessage } from "./sendMessage";
import { recordFailure, setNotificationDelivered } from "../db/notificationRepository";
import { getChatIdByMailboxId, setChatStatus } from "../db/userRepository";
import { setLastDeliveredAt } from "../db/mailboxRepository";

const row = {
    id: 7, mailboxId: 3, gmailMessageId: "m1", status: "pending" as const, attempts: 0,
    nextAttemptAt: new Date(), fromHeader: null, subject: "s", vacancy: "Dev",
    employer: "ACME", outcome: "Приглашение", sentAt: null, lastError: null, createdAt: new Date(),
    replayedAt: null,
};

beforeEach(() => vi.clearAllMocks());

describe("deliverNotification", () => {
    it("sends, then fixes sent, then marks chat ok — in that order", async () => {
        vi.mocked(getChatIdByMailboxId).mockResolvedValue("123");
        vi.mocked(sendMessage).mockResolvedValue({} as never);
        await deliverNotification(row);
        expect(sendMessage).toHaveBeenCalledWith(123, expect.stringContaining("Dev"));
        expect(setNotificationDelivered).toHaveBeenCalledWith("m1", 3);
        expect(setChatStatus).toHaveBeenCalledWith("123", "ok");
        expect(recordFailure).not.toHaveBeenCalled();
        // send strictly precedes the `sent` write (FR-11/FR-7)
        expect(vi.mocked(sendMessage).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(setNotificationDelivered).mock.invocationCallOrder[0]);
        expect(setLastDeliveredAt).toHaveBeenCalledWith(3, expect.any(Date));
        expect(vi.mocked(setNotificationDelivered).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(setLastDeliveredAt).mock.invocationCallOrder[0]);
    });

    it("records a failure without a sent write on transient errors", async () => {
        vi.mocked(getChatIdByMailboxId).mockResolvedValue("123");
        vi.mocked(sendMessage).mockRejectedValue(new Error("ETIMEDOUT"));
        await deliverNotification(row);
        expect(setNotificationDelivered).not.toHaveBeenCalled();
        expect(recordFailure).toHaveBeenCalledWith(7, expect.stringContaining("ETIMEDOUT"));
        expect(setChatStatus).not.toHaveBeenCalled();
    });

    it("flags the chat as blocked on 403 but still records the failure", async () => {
        vi.mocked(getChatIdByMailboxId).mockResolvedValue("123");
        const forbidden = Object.assign(new Error("Forbidden: bot was blocked"), { error_code: 403 });
        vi.mocked(sendMessage).mockRejectedValue(forbidden);
        await deliverNotification(row);
        expect(setChatStatus).toHaveBeenCalledWith("123", "blocked");
        expect(recordFailure).toHaveBeenCalledWith(7, expect.any(String));
        expect(setNotificationDelivered).not.toHaveBeenCalled();
    });

    it("does not send when the mailbox has no chat and records instead", async () => {
        vi.mocked(getChatIdByMailboxId).mockResolvedValue(null);
        await deliverNotification(row);
        expect(sendMessage).not.toHaveBeenCalled();
        expect(recordFailure).toHaveBeenCalledWith(7, expect.stringContaining("no chat"));
    });

    it("resolves the chat on every attempt (rebind mid-retries, FR-15)", async () => {
        vi.mocked(getChatIdByMailboxId).mockResolvedValueOnce("1").mockResolvedValueOnce("2");
        vi.mocked(sendMessage).mockResolvedValue({} as never);
        await deliverNotification(row);
        await deliverNotification(row);
        expect(vi.mocked(sendMessage).mock.calls.map((c) => c[0])).toEqual([1, 2]);
    });

    it("logs a structured success event for observability", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        vi.mocked(getChatIdByMailboxId).mockResolvedValue("123");
        vi.mocked(sendMessage).mockResolvedValue({} as never);
        try {
            await deliverNotification(row);
            expect(log).toHaveBeenCalledWith(expect.objectContaining({
                event: "notification_sent",
                id: 7,
                mailboxId: 3,
                gmailMessageId: "m1",
                chatId: "123",
            }));
        } finally {
            log.mockRestore();
        }
    });
});
