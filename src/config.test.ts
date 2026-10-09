import { afterEach, describe, expect, it, vi } from "vitest";

const baseEnv: Record<string, string> = {
    PORT: "8080",
    TG_BOT_TOKEN: "tg-token",
    TELEGRAM_WEBHOOK_SECRET: "hook-secret",
    PUBLIC_BASE_URL: "https://bot.example.com",
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
    GOOGLE_REDIRECT_URI: "https://bot.example.com/oauth/callback",
    GOOGLE_TOPIC_NAME: "projects/p/topics/t",
    DATABASE_URL: "postgres://user:pass@localhost:5432/db",
};

async function loadConfig(overrides: Record<string, string | undefined>) {
    vi.resetModules();
    for (const [key, value] of Object.entries(baseEnv))
        process.env[key] = value;
    for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined)
            delete process.env[key];
        else
            process.env[key] = value;
    }
    const { EnvConfig } = await import("./config.js");
    return EnvConfig;
}

afterEach(() => {
    vi.resetModules();
});

describe("EnvConfig", () => {
    it("loads a valid environment and strips the trailing slash from PUBLIC_BASE_URL", async () => {
        const config = await loadConfig({ PUBLIC_BASE_URL: "https://bot.example.com/" });
        expect(config.publicBaseUrl).toBe("https://bot.example.com");
        expect(config.telegramWebhookSecret).toBe("hook-secret");
        expect(config.port).toBe(8080);
    });

    it("rejects a missing TELEGRAM_WEBHOOK_SECRET", async () => {
        await expect(loadConfig({ TELEGRAM_WEBHOOK_SECRET: undefined })).rejects.toThrow();
    });

    it("rejects a missing PUBLIC_BASE_URL", async () => {
        await expect(loadConfig({ PUBLIC_BASE_URL: undefined })).rejects.toThrow();
    });

    it("rejects a non-http PUBLIC_BASE_URL", async () => {
        await expect(loadConfig({ PUBLIC_BASE_URL: "ftp://bot.example.com" })).rejects.toThrow();
    });

    it("rejects an unparseable PUBLIC_BASE_URL", async () => {
        await expect(loadConfig({ PUBLIC_BASE_URL: "not a url" })).rejects.toThrow();
    });
});
