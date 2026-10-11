import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AddressInfo } from "net";

vi.mock("./config", () => ({
    EnvConfig: {
        telegramWebhookSecret: "hook-secret",
        publicBaseUrl: "https://bot.example.com",
        googleConsentMode: "testing" as const,
        rabotaSubjectPatterns: [],
        googleAuth: { clientId: "c", secret: "s", redirectUri: "r", topicName: "t" },
        database: { databaseUrl: "postgres://x" },
        port: 0,
        tgBotToken: "t",
        tokenEncryptionKey: "b".repeat(64),
    },
}));
vi.mock("./bot", () => ({
    getBot: vi.fn(() => ({
        botInfo: { id: 1, is_bot: true, username: "testbot", first_name: "Test", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false },
        isRunning: () => false,
        init: vi.fn(async () => undefined),
        handleUpdate: vi.fn(async () => undefined),
    })),
}));
vi.mock("./bot/loadHandlers", () => ({ loadHandlers: vi.fn() }));
vi.mock("./auth/routes", () => ({ __esModule: true, default: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("./gmail/routes", () => ({ gmailRouter: (_req: unknown, _res: unknown, next: () => void) => next() }));

import { createApp } from "./app";

const update = { update_id: 1, message: { message_id: 1, date: 1, chat: { id: 1, type: "private" }, text: "/start" } };

async function postWebhook(headers: Record<string, string>) {
    const app = createApp();
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    try {
        const { port } = server.address() as AddressInfo;
        const res = await fetch(`http://127.0.0.1:${port}/telegram/webhook`, {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify(update),
        });
        return res.status;
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

describe("webhook secret (WP3)", () => {
    beforeEach(() => vi.clearAllMocks());

    it("rejects a request without the secret header with 401", async () => {
        expect(await postWebhook({})).toBe(401);
    });

    it("rejects a wrong secret with 401", async () => {
        expect(await postWebhook({ "x-telegram-bot-api-secret-token": "wrong" })).toBe(401);
    });

    it("accepts the correct secret", async () => {
        expect(await postWebhook({ "x-telegram-bot-api-secret-token": "hook-secret" })).toBe(200);
    });
});
