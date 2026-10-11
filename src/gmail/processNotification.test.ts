import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/notificationRepository", () => ({
    addNotifications: vi.fn(),
    listByMessageIds: vi.fn(),
    listDeliverableByMailbox: vi.fn(),
    markStaleAsSentForMailbox: vi.fn(async () => 0),
}));
vi.mock("../db/mailboxRepository", () => ({
    getMailbox: vi.fn(),
    advanceBasis: vi.fn(),
    setAccessFailure: vi.fn(),
    registerTransientFailure: vi.fn(),
    wasFailureNotified: vi.fn(),
    claimFailureNotice: vi.fn(),
    registerPipelineSuccess: vi.fn(),
    consumeFailureNotice: vi.fn(),
}));
vi.mock("./getMessages", () => ({ getDataFromMessages: vi.fn() }));
vi.mock("./getMessageIds", () => ({ getMessageIds: vi.fn() }));
vi.mock("./catchUpMailbox", () => ({ catchUpMailbox: vi.fn() }));
vi.mock("../bot/deliverBatch", () => ({ deliverBatchUntilTerminal: vi.fn() }));
vi.mock("./getUserGmailClient", () => ({ getUserGmailClient: vi.fn() }));
vi.mock("../bot/notifyMailboxOwner", () => ({ notifyMailboxOwner: vi.fn() }));

import { processNotification } from "./processNotification";
import { listByMessageIds, listDeliverableByMailbox, markStaleAsSentForMailbox } from "../db/notificationRepository";
import { advanceBasis, getMailbox, setAccessFailure } from "../db/mailboxRepository";
import { getDataFromMessages } from "./getMessages";
import { getMessageIds } from "./getMessageIds";
import { catchUpMailbox } from "./catchUpMailbox";
import { deliverBatchUntilTerminal } from "../bot/deliverBatch";
import { getUserGmailClient } from "./getUserGmailClient";
import { notifyMailboxOwner } from "../bot/notifyMailboxOwner";

const decoded = { emailAddress: "a@b.c", historyId: "100" };
const mailbox = { id: 7, email: "a@b.c", refreshToken: "refresh-token", accessStatus: "active", historyIdBasis: null as string | null };

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMailbox).mockResolvedValue(mailbox as never);
    vi.mocked(getUserGmailClient).mockReturnValue({} as never);
    vi.mocked(getMessageIds).mockResolvedValue({ messageIds: ["m1"], newHistoryId: "101" });
    vi.mocked(getDataFromMessages).mockResolvedValue([]);
    vi.mocked(listByMessageIds).mockResolvedValue([] as never);
    vi.mocked(listDeliverableByMailbox).mockResolvedValue([] as never);
    vi.mocked(markStaleAsSentForMailbox).mockResolvedValue(0 as never);
    vi.mocked(advanceBasis).mockResolvedValue(true);
    vi.mocked(setAccessFailure).mockResolvedValue(undefined as never);
    vi.mocked(catchUpMailbox).mockResolvedValue({ outcome: "ok" } as never);
    vi.mocked(deliverBatchUntilTerminal).mockResolvedValue("terminal");
    vi.mocked(notifyMailboxOwner).mockResolvedValue(true as never);
});

describe("processNotification (service without HTTP)", () => {
    it("acks an unknown mailbox and never touches Gmail", async () => {
        vi.mocked(getMailbox).mockResolvedValue(null);
        await expect(processNotification(decoded)).resolves.toBe("ack");
        expect(getMessageIds).not.toHaveBeenCalled();
    });

    it("retries while the delivered batch is not terminal", async () => {
        vi.mocked(listByMessageIds).mockResolvedValue([{ id: 11 }] as never);
        vi.mocked(deliverBatchUntilTerminal).mockResolvedValue("budget_exceeded");
        await expect(processNotification(decoded)).resolves.toBe("retry");
        expect(deliverBatchUntilTerminal).toHaveBeenCalledWith([11]);
    });

    it("fails when mailbox access is not active and never touches Gmail", async () => {
        vi.mocked(getMailbox).mockResolvedValue({ ...mailbox, accessStatus: "expired" } as never);
        await expect(processNotification(decoded)).resolves.toBe("fail");
        expect(getMessageIds).not.toHaveBeenCalled();
        expect(setAccessFailure).not.toHaveBeenCalled();
    });

    it("maps a hard Gmail failure onto setAccessFailure and the owner notice", async () => {
        vi.mocked(getMessageIds).mockRejectedValue(new Error("invalid_grant: Token has been expired or revoked."));
        await expect(processNotification(decoded)).resolves.toBe("fail");
        expect(setAccessFailure).toHaveBeenCalledWith("a@b.c", "expired");
        expect(notifyMailboxOwner).toHaveBeenCalledTimes(1);
    });

    it("falls back to the catch-up pass when the stored basis is stale (FR-14)", async () => {
        vi.mocked(getMailbox).mockResolvedValue({ ...mailbox, historyIdBasis: "90" } as never);
        vi.mocked(getMessageIds).mockRejectedValue(Object.assign(new Error("stale history id"), { response: { status: 404 } }));
        vi.mocked(catchUpMailbox).mockResolvedValue({ outcome: "ok" } as never);
        await expect(processNotification(decoded)).resolves.toBe("ack");
        expect(catchUpMailbox).toHaveBeenCalledTimes(1);
    });
});
