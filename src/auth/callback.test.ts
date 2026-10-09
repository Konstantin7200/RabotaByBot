import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config", () => ({
    EnvConfig: {
        googleAuth: { clientId: "client-id", secret: "s", redirectUri: "r", topicName: "t" },
        publicBaseUrl: "https://bot.example.com",
    },
}));
vi.mock("../db/oauthKeysRepository", () => ({ takeKey: vi.fn() }));
vi.mock("../db/userRepository", () => ({
    createIfNotExists: vi.fn(),
    getByChatId: vi.fn(),
    getChatIdByUserId: vi.fn(),
}));
vi.mock("../db/mailboxRepository", () => ({
    createMailbox: vi.fn(),
    getByUserId: vi.fn(),
    getMailbox: vi.fn(),
    setWatchSuccess: vi.fn(),
}));
vi.mock("../gmail/watch", () => ({ installWatch: vi.fn() }));
vi.mock("../gmail/catchUpMailbox", () => ({ catchUpMailbox: vi.fn() }));
vi.mock("../gmail/untrackMailbox", () => ({ untrackMailbox: vi.fn() }));
vi.mock("../bot/sendMessage", () => ({ sendMessage: vi.fn() }));
vi.mock("./getTokens", () => ({ getTokens: vi.fn() }));
vi.mock("./index", () => ({
    auth: { verifyIdToken: vi.fn() },
}));

import { callback } from "./callback";
import { takeKey } from "../db/oauthKeysRepository";
import { getByChatId, getChatIdByUserId } from "../db/userRepository";
import { createMailbox, getByUserId, getMailbox, setWatchSuccess } from "../db/mailboxRepository";
import { installWatch } from "../gmail/watch";
import { untrackMailbox } from "../gmail/untrackMailbox";
import { sendMessage } from "../bot/sendMessage";
import { getTokens } from "./getTokens";
import { auth } from ".";
import { MESSAGE_FOR_AUTH_FAILED } from "../constants";

const CHAT_ID = 42;
const tokens = { idToken: "id-token", refreshToken: "refresh-token", accessToken: "access-token" };
const expiry = new Date("2026-10-16T00:00:00.000Z");

function makeRequest(query: Record<string, unknown>) {
    return { query } as never;
}

function makeResponse() {
    const res = { status: vi.fn(), send: vi.fn(), sendFile: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    res.send.mockReturnValue(res);
    res.sendFile.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(takeKey).mockResolvedValue({ key: "state", chatId: String(CHAT_ID), expiresAt: new Date(), createdAt: new Date() } as never);
    vi.mocked(getTokens).mockResolvedValue(tokens as never);
    vi.mocked(getByChatId).mockResolvedValue({ id: 1, chatId: String(CHAT_ID), chatStatus: "ok" } as never);
    vi.mocked(getMailbox).mockResolvedValue(null);
    vi.mocked(getByUserId).mockResolvedValue(null);
    vi.mocked(getChatIdByUserId).mockResolvedValue(null);
    vi.mocked(installWatch).mockResolvedValue({ historyId: "200", expirationDate: expiry } as never);
    vi.mocked(sendMessage).mockResolvedValue({} as never);
    vi.mocked(auth.verifyIdToken).mockResolvedValue({
        getPayload: () => ({ email: "u@b.c" }),
    } as never);
});

async function runSuccess(query: Record<string, unknown> = { state: "s", code: "c" }) {
    const res = makeResponse();
    await callback(makeRequest(query), res as never);
    return res;
}

describe("callback (FR-3, US-1)", () => {
    it("notifies the chat when the authorization code is missing", async () => {
        const res = await runSuccess({ state: "s" });
        expect(sendMessage).toHaveBeenCalledWith(CHAT_ID, MESSAGE_FOR_AUTH_FAILED);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(installWatch).not.toHaveBeenCalled();
    });

    it("sends nothing to the database when the watch cannot be installed", async () => {
        vi.mocked(installWatch).mockRejectedValue(new Error("gmail down"));
        const res = await runSuccess();
        expect(createMailbox).not.toHaveBeenCalled();
        expect(setWatchSuccess).not.toHaveBeenCalled();
        expect(untrackMailbox).not.toHaveBeenCalled();
        expect(sendMessage).toHaveBeenCalledWith(CHAT_ID, MESSAGE_FOR_AUTH_FAILED);
        expect(res.status).toHaveBeenCalledWith(500);
    });

    it("installs the watch before persisting the mailbox", async () => {
        await runSuccess();
        expect(vi.mocked(installWatch).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(createMailbox).mock.invocationCallOrder[0]);
        expect(vi.mocked(createMailbox).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(setWatchSuccess).mock.invocationCallOrder[0]);
    });

    it("confirms the link in Telegram with the bound email and shows the success page (US-1)", async () => {
        const res = await runSuccess();
        expect(sendMessage).toHaveBeenCalledWith(CHAT_ID, expect.stringContaining("u@b.c"));
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.sendFile).toHaveBeenCalled();
    });

    it("reports access recovery instead of a plain login when the previous status was broken", async () => {
        vi.mocked(getMailbox).mockResolvedValue({
            id: 9, email: "u@b.c", userId: 7, accessStatus: "expired",
            refreshToken: "rt", historyIdBasis: "100",
        } as never);
        await runSuccess();
        expect(sendMessage).toHaveBeenCalledWith(CHAT_ID, expect.stringContaining("restored"));
    });

    it("does not unlink a replaced mailbox when the watch for the new one fails", async () => {
        vi.mocked(getByUserId).mockResolvedValue({
            id: 3, email: "old@b.c", userId: 1, accessStatus: "active", refreshToken: "rt",
        } as never);
        vi.mocked(installWatch).mockRejectedValue(new Error("gmail down"));
        await runSuccess();
        expect(untrackMailbox).not.toHaveBeenCalled();
    });
});
