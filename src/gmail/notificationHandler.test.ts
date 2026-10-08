import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/notificationRepository", () => ({
    addNotifications: vi.fn(),
    listByMessageIds: vi.fn(),
}));
vi.mock("../db/mailboxRepository", () => ({
    getMailbox: vi.fn(),
    advanceBasis: vi.fn(),
}));
vi.mock("./getMessages", () => ({ getDataFromMessages: vi.fn() }));
vi.mock("./getMessageIds", () => ({ getMessageIds: vi.fn() }));
vi.mock("../bot/deliverBatch", () => ({ deliverBatchUntilTerminal: vi.fn() }));
vi.mock("./getUserGmailClient", () => ({ getUserGmailClient: vi.fn() }));

import { notificationHandler } from "./notificationHandler";
import { addNotifications, listByMessageIds } from "../db/notificationRepository";
import { advanceBasis, getMailbox } from "../db/mailboxRepository";
import { getDataFromMessages } from "./getMessages";
import { getMessageIds } from "./getMessageIds";
import { deliverBatchUntilTerminal } from "../bot/deliverBatch";

const mailbox = { id: 7, refreshToken: "refresh-token" } as never;
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
    vi.mocked(getMailbox).mockResolvedValue(mailbox);
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
});
