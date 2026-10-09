import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/notificationRepository", () => ({ addNotifications: vi.fn(), listByMessageIds: vi.fn() }));
vi.mock("../db/mailboxRepository", () => ({ advanceBasis: vi.fn(), setAccessFailure: vi.fn() }));
vi.mock("./getMessages", () => ({ getDataFromMessages: vi.fn() }));
vi.mock("./getMessageIds", () => ({ getMessageIds: vi.fn() }));
vi.mock("./listMessageIdsSince", () => ({ listMessageIdsSince: vi.fn() }));
vi.mock("../bot/deliverBatch", () => ({ deliverBatchUntilTerminal: vi.fn() }));
vi.mock("./getUserGmailClient", () => ({ getUserGmailClient: vi.fn() }));
vi.mock("../bot/notifyMailboxOwner", () => ({ notifyMailboxOwner: vi.fn() }));

import { catchUpMailbox } from "./catchUpMailbox";
import { addNotifications, listByMessageIds } from "../db/notificationRepository";
import { advanceBasis, setAccessFailure } from "../db/mailboxRepository";
import { getDataFromMessages } from "./getMessages";
import { getMessageIds } from "./getMessageIds";
import { listMessageIdsSince } from "./listMessageIdsSince";
import { deliverBatchUntilTerminal } from "../bot/deliverBatch";
import { getUserGmailClient } from "./getUserGmailClient";
import { notifyMailboxOwner } from "../bot/notifyMailboxOwner";
import { MESSAGE_WATCH_EXPIRED, MESSAGE_MAIL_PROCESSING_ERROR } from "../constants";
import { MailboxesTable } from "../db/entityTypes";

const BASIS_AT = new Date("2026-10-09T00:00:00.000Z");
const GRANTED_AT = new Date("2026-10-01T00:00:00.000Z");
const mailbox = {
    id: 7, email: "a@b.c", refreshToken: "rt", accessStatus: "active",
    historyIdBasis: "100", historyIdBasisAt: BASIS_AT, tokenGrantedAt: GRANTED_AT,
} as unknown as MailboxesTable;
const gmail = { users: { getProfile: vi.fn() } };
const messageData = (gmailMessageId: string) => ({
    gmailMessageId, subject: "S", vacancy: "Dev", employer: "ACME", outcome: "applied",
});
const notFound = Object.assign(new Error("not found"), { response: { status: 404 } });

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserGmailClient).mockReturnValue(gmail as never);
    vi.mocked(getMessageIds).mockResolvedValue({ messageIds: ["m1"], newHistoryId: "101" });
    vi.mocked(getDataFromMessages).mockResolvedValue([messageData("m1")]);
    vi.mocked(addNotifications).mockResolvedValue(1);
    vi.mocked(listByMessageIds).mockResolvedValue([{ id: 11 }] as never);
    vi.mocked(advanceBasis).mockResolvedValue(true);
    vi.mocked(setAccessFailure).mockResolvedValue(undefined as never);
    vi.mocked(notifyMailboxOwner).mockResolvedValue(undefined as never);
    vi.mocked(deliverBatchUntilTerminal).mockResolvedValue("terminal");
    vi.mocked(listMessageIdsSince).mockResolvedValue(["m1"]);
    vi.mocked(gmail.users.getProfile).mockResolvedValue({ data: { historyId: "200" } });
});

describe("catchUpMailbox — skip rules", () => {
    it.each([
        ["not_active", { accessStatus: "expired" }],
        ["no_token", { refreshToken: null }],
        ["no_basis", { historyIdBasis: null }],
    ])("skips with %s without touching Gmail", async (reason, patch) => {
        await expect(catchUpMailbox({ ...mailbox, ...patch } as never))
            .resolves.toEqual({ outcome: "skipped", reason });
        expect(getUserGmailClient).not.toHaveBeenCalled();
    });
});

describe("catchUpMailbox — history path", () => {
    it("scans from the stored basis, inserts first, then advances, then delivers", async () => {
        const result = await catchUpMailbox(mailbox);
        expect(getMessageIds).toHaveBeenCalledWith(gmail, "a@b.c", "100");
        expect(result).toEqual({ outcome: "ok", source: "history", scanned: 1, inserted: 1, delivered: 1 });
        expect(vi.mocked(addNotifications).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(advanceBasis).mock.invocationCallOrder[0]);
        expect(advanceBasis).toHaveBeenCalledWith(7, "101");
        expect(listByMessageIds).toHaveBeenCalledWith(7, ["m1"]);
        expect(deliverBatchUntilTerminal).toHaveBeenCalledWith([11]);
    });

    it("advances the basis on an empty scan without inserting or delivering", async () => {
        vi.mocked(getMessageIds).mockResolvedValue({ messageIds: [], newHistoryId: "101" });
        await expect(catchUpMailbox(mailbox)).resolves
            .toEqual({ outcome: "ok", source: "history", scanned: 0, inserted: 0, delivered: 0 });
        expect(addNotifications).not.toHaveBeenCalled();
        expect(deliverBatchUntilTerminal).not.toHaveBeenCalled();
        expect(advanceBasis).toHaveBeenCalledWith(7, "101");
    });

    it("does not advance the basis when the scan throws", async () => {
        const err = Object.assign(new Error("boom"), { code: 503 });
        vi.mocked(getMessageIds).mockRejectedValue(err);
        await expect(catchUpMailbox(mailbox)).rejects.toThrow("boom");
        expect(advanceBasis).not.toHaveBeenCalled();
        expect(setAccessFailure).not.toHaveBeenCalled();   // transient
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
    });

    it("does not advance the basis when ingestion throws", async () => {
        vi.mocked(getDataFromMessages).mockRejectedValue(Object.assign(new Error("forbidden"), { code: 403 }));
        await expect(catchUpMailbox(mailbox)).rejects.toThrow("forbidden");
        expect(advanceBasis).not.toHaveBeenCalled();
        expect(setAccessFailure).toHaveBeenCalledWith("a@b.c", "error");
        expect(notifyMailboxOwner).toHaveBeenCalledWith(7, MESSAGE_MAIL_PROCESSING_ERROR("a@b.c"));
    });

    it("marks expired and notifies on invalid_grant", async () => {
        vi.mocked(getMessageIds).mockRejectedValue(new Error("invalid_grant: revoked"));
        await expect(catchUpMailbox(mailbox)).rejects.toThrow("invalid_grant");
        expect(setAccessFailure).toHaveBeenCalledWith("a@b.c", "expired");
        expect(notifyMailboxOwner).toHaveBeenCalledWith(7, MESSAGE_WATCH_EXPIRED("a@b.c"));
        expect(advanceBasis).not.toHaveBeenCalled();
    });
});

describe("catchUpMailbox — messages.list fallback on stale history id", () => {
    it("falls back on 404, scans from the basis timestamp, advances from getProfile", async () => {
        vi.mocked(getMessageIds).mockRejectedValue(notFound);
        const expectedAfter = Math.floor(BASIS_AT.getTime() / 1000) - 1;
        const result = await catchUpMailbox(mailbox);
        expect(listMessageIdsSince).toHaveBeenCalledWith(gmail, "a@b.c", expectedAfter);
        expect(gmail.users.getProfile).toHaveBeenCalledWith({ userId: "a@b.c" });
        expect(advanceBasis).toHaveBeenCalledWith(7, "200");
        expect(setAccessFailure).not.toHaveBeenCalled();
        expect(notifyMailboxOwner).not.toHaveBeenCalled();
        expect(result).toMatchObject({ outcome: "ok", source: "messages_fallback" });
    });

    it("falls back to epoch when the basis timestamp is missing (legacy row)", async () => {
        vi.mocked(getMessageIds).mockRejectedValue(notFound);
        await catchUpMailbox({ ...mailbox, historyIdBasisAt: null } as never);
        expect(listMessageIdsSince).toHaveBeenCalledWith(gmail, "a@b.c", 0);
    });

    it("scans from epoch when both timestamps are missing", async () => {
        vi.mocked(getMessageIds).mockRejectedValue(notFound);
        await catchUpMailbox({ ...mailbox, historyIdBasisAt: null, tokenGrantedAt: null } as never);
        expect(listMessageIdsSince).toHaveBeenCalledWith(gmail, "a@b.c", 0);
    });

    it("does not advance the basis when getProfile fails after the fallback scan", async () => {
        vi.mocked(getMessageIds).mockRejectedValue(notFound);
        vi.mocked(gmail.users.getProfile).mockRejectedValue(Object.assign(new Error("boom"), { code: 503 }));
        await expect(catchUpMailbox(mailbox)).rejects.toThrow("boom");
        expect(advanceBasis).not.toHaveBeenCalled();
    });

    it("treats a 404 from messages.get as an ordinary error, not a fallback trigger", async () => {
        vi.mocked(getDataFromMessages).mockRejectedValue(notFound);
        await expect(catchUpMailbox(mailbox)).rejects.toThrow("not found");
        expect(listMessageIdsSince).not.toHaveBeenCalled();
        expect(setAccessFailure).toHaveBeenCalledWith("a@b.c", "error");
        expect(advanceBasis).not.toHaveBeenCalled();
    });
});

