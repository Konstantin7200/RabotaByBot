import { describe, expect, it, vi } from "vitest";
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
vi.mock("grammy", () => ({ webhookCallback: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()) }));
vi.mock("./bot", () => ({ getBot: vi.fn(() => ({})) }));
vi.mock("./bot/loadHandlers", () => ({ loadHandlers: vi.fn() }));
vi.mock("./auth/routes", () => ({ __esModule: true, default: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("./gmail/routes", () => ({ gmailRouter: (_req: unknown, _res: unknown, next: () => void) => next() }));

import { webhookCallback } from "grammy";
import { loadHandlers } from "./bot/loadHandlers";
import { createApp } from "./app";

describe("createApp (WP3 webhook wiring)", () => {
    it("registers the Telegram webhook with the configured secret token", () => {
        createApp();
        expect(webhookCallback).toHaveBeenCalledWith(
            expect.anything(),
            "express",
            { secretToken: "hook-secret" },
        );
    });

    it("loads bot handlers exactly once per app", () => {
        createApp();
        expect(loadHandlers).toHaveBeenCalledTimes(1);
    });

    it("serves GET /health", async () => {
        const app = createApp();
        const server = app.listen(0);
        await new Promise<void>((resolve) => server.once("listening", () => resolve()));
        try {
            const { port } = server.address() as AddressInfo;
            const res = await fetch(`http://127.0.0.1:${port}/health`);
            expect(res.status).toBe(200);
            expect(await res.text()).toBe("ok");
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});

