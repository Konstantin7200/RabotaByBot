import { afterEach, describe, expect, it, vi } from "vitest";

const baseEnv: Record<string, string> = {
    PORT: "8080",
    TG_BOT_TOKEN: "tg-token",
    TELEGRAM_WEBHOOK_SECRET: "hook-secret",
    PUBLIC_BASE_URL: "https://bot.example.com",
    TOKEN_ENCRYPTION_KEY: "b".repeat(64),
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

    it("rejects a TOKEN_ENCRYPTION_KEY that is not 64 hex characters", async () => {
        await expect(loadConfig({ TOKEN_ENCRYPTION_KEY: "nope" })).rejects.toThrow();
    });

    it("parses RABOTA_SUBJECT_PATTERNS into a trimmed list", async () => {
        const config = await loadConfig({
            RABOTA_SUBJECT_PATTERNS: "ответ на отклик,  Вакансия ,",
        });
        expect(config.rabotaSubjectPatterns).toEqual(["ответ на отклик", "Вакансия"]);
    });

    it("defaults rabotaSubjectPatterns to an empty list (domain-only gate)", async () => {
        const config = await loadConfig({ RABOTA_SUBJECT_PATTERNS: undefined });
        expect(config.rabotaSubjectPatterns).toEqual([]);
    });

    it("defaults googleConsentMode to testing and accepts production", async () => {
        expect((await loadConfig({ GOOGLE_CONSENT_MODE: undefined })).googleConsentMode).toBe("testing");
        expect((await loadConfig({ GOOGLE_CONSENT_MODE: "production" })).googleConsentMode).toBe("production");
        await expect(loadConfig({ GOOGLE_CONSENT_MODE: "weird" })).rejects.toThrow();
    });
});
