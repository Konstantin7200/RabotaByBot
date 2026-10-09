import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/notificationRepository", () => ({
    addNotifications: vi.fn(),
    listByMessageIds: vi.fn(),
}));
vi.mock("../db/mailboxRepository", () => ({
    getMailbox: vi.fn(),
    advanceBasis: vi.fn(),
    setAccessFailure: vi.fn(),
}));
vi.mock("./getMessages", () => ({ getDataFromMessages: vi.fn() }));
vi.mock("./getMessageIds", () => ({ getMessageIds: vi.fn() }));
vi.mock("../bot/deliverBatch", () => ({ deliverBatchUntilTerminal: vi.fn() }));
vi.mock("./getUserGmailClient", () => ({ getUserGmailClient: vi.fn() }));
vi.mock("../bot/notifyMailboxOwner", () => ({ notifyMailboxOwner: vi.fn() }));

import { notificationHandler } from "./notificationHandler";
import { addNotifications, listByMessageIds } from "../db/notificationRepository";
import { advanceBasis, getMailbox, setAccessFailure } from "../db/mailboxRepository";
import { getDataFromMessages } from "./getMessages";
import { getMessageIds } from "./getMessageIds";
import { deliverBatchUntilTerminal } from "../bot/deliverBatch";
import { getUserGmailClient } from "./getUserGmailClient";
import { notifyMailboxOwner } from "../bot/notifyMailboxOwner";
import { MESSAGE_WATCH_EXPIRED, MESSAGE_MAIL_PROCESSING_ERROR } from "../constants";

const mailbox = { id: 7, email: "a@b.c", refreshToken: "refresh-token", accessStatus: "active" };
const messageData = (gmailMessageId: string) => ({
    gmailMessageId,
    subject: "Subject",
    vacancy: "Developer",
    employer: "Employer",
    outcome: "applied",
});

function makeRequest() {
    const payload = Buffer.from(
        JSON.stringify({ emailAddress: "a@b.c", historyId: "100" })
    ).toString("base64");
    return { body: { message: { data: payload }, subscription: "projects/p/subscriptions/s" } } as never;
}

function makeResponse() {
    const res = { status: vi.fn(), send: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    res.send.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMailbox).mockResolvedValue(mailbox as never);
    vi.mocked(setAccessFailure).mockResolvedValue(undefined as never);
    vi.mocked(getMessageIds).mockResolvedValue({ messageIds: ["m1"], newHistoryId: "101" });
    vi.mocked(getDataFromMessages).mockResolvedValue([messageData("m1")]);
    vi.mocked(addNotifications).mockResolvedValue(null as never);
    vi.mocked(advanceBasis).mockResolvedValue(undefined);
    vi.mocked(deliverBatchUntilTerminal).mockResolvedValue("terminal");
});

describe("notificationHandler", () => {
    it("drives pre-existing pending rows to terminal and acks with 200", async () => {
        vi.mocked(listByMessageIds).mockResolvedValue([{ id: 11 }, { id: 12 }] as never);

        const res = makeResponse();
        await notificationHandler(makeRequest(), res as never);

        expect(addNotifications).toHaveBeenCalledTimes(1);
        expect(advanceBasis).toHaveBeenCalledWith(7, "101");
        expect(deliverBatchUntilTerminal).toHaveBeenCalledWith([11, 12]);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("nacks with 503 when the batch loop reports budget_exceeded", async () => {
        vi.mocked(listByMessageIds).mockResolvedValue([{ id: 11 }] as never);
        vi.mocked(deliverBatchUntilTerminal).mockResolvedValue("budget_exceeded");

        const res = makeResponse();
        await notificationHandler(makeRequest(), res as never);

        expect(deliverBatchUntilTerminal).toHaveBeenCalledWith([11]);
        expect(res.status).toHaveBeenCalledWith(503);
    });

    it("acks empty message data without inserting, advancing the basis first", async () => {
        vi.mocked(getDataFromMessages).mockResolvedValue([]);
        vi.mocked(listByMessageIds).mockResolvedValue([] as never);

        const res = makeResponse();
        await notificationHandler(makeRequest(), res as never);

        expect(addNotifications).not.toHaveBeenCalled();
        expect(listByMessageIds).toHaveBeenCalledWith(7, []);
        expect(advanceBasis).toHaveBeenCalledWith(7, "101");
        expect(deliverBatchUntilTerminal).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("acks with 200 and skips Gmail when the mailbox is unknown", async () => {
        vi.mocked(getMailbox).mockResolvedValue(null);
        const res = makeResponse();
        await notificationHandler(makeRequest(), res as never);
        expect(getMessageIds).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("acks with 200 for an unlinked mailbox (FR-9 discards the mail)", async () => {
        vi.mocked(getMailbox).mockResolvedValue({ ...mailbox, accessStatus: "unlinked" } as never);
        const res = makeResponse();
        await notificationHandler(makeRequest(), res as never);
        expect(getMessageIds).not.toHaveBeenCalled();
        expect(setAccessFailure).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("holds an already-lost mailbox with 500 and no Gmail calls", async () => {
        vi.mocked(getMailbox).mockResolvedValue({ ...mailbox, accessStatus: "expired" } as never);
        const res = makeResponse();
        await notificationHandler(makeRequest(), res as never);
        expect(getMessageIds).not.toHaveBeenCalled();
        expect(getUserGmailClient).not.toHaveBeenCalled();
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
        expect(setAccessFailure).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
    });

    it("marks expired, notifies once, and holds the push on invalid_grant (FR-12 б)", async () => {
        vi.mocked(getMessageIds).mockRejectedValue(new Error("invalid_grant: Token has been expired or revoked."));
        const res = makeResponse();
        await notificationHandler(makeRequest(), res as never);
        expect(setAccessFailure).toHaveBeenCalledWith("a@b.c", "expired");
        expect(notifyMailboxOwner).toHaveBeenCalledWith(7, MESSAGE_WATCH_EXPIRED("a@b.c"));
        expect(advanceBasis).not.toHaveBeenCalled();
        expect(addNotifications).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
    });

    it("holds transient Gmail failures without marking or notifying", async () => {
        const err = new Error("boom") as Error & { code: number };
        err.code = 503;
        vi.mocked(getMessageIds).mockRejectedValue(err);
        const res = makeResponse();
        await notificationHandler(makeRequest(), res as never);
        expect(setAccessFailure).not.toHaveBeenCalled();
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
        expect(advanceBasis).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
    });

    it("marks error and notifies on a hard Gmail API failure (FR-12 в)", async () => {
        const err = new Error("forbidden") as Error & { code: number };
        err.code = 403;
        vi.mocked(getDataFromMessages).mockRejectedValue(err);
        const res = makeResponse();
        await notificationHandler(makeRequest(), res as never);
        expect(setAccessFailure).toHaveBeenCalledWith("a@b.c", "error");
        expect(notifyMailboxOwner).toHaveBeenCalledWith(7, MESSAGE_MAIL_PROCESSING_ERROR("a@b.c"));
        expect(advanceBasis).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
    });
});
