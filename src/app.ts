import express, { Express } from "express";
import { webhookCallback } from "grammy";
import { EnvConfig } from "./config";
import { loadHandlers } from "./bot/loadHandlers";
import { getBot } from "./bot";
import router from "./auth/routes";
import { gmailRouter } from "./gmail/routes";
import { PUBLIC_DIR } from "./constants";

// Kept separate from index.ts so tests can exercise the wiring (webhook
// secret, health endpoint, route order) without starting the server.
export function createApp(): Express {
    const app = express();
    app.get("/health", (_req, res) => {
        res.send("ok");
    });
    loadHandlers();
    app.use(express.json());
    app.use(express.static(PUBLIC_DIR));
    app.post(
        "/telegram/webhook",
        webhookCallback(getBot(), "express", { secretToken: EnvConfig.telegramWebhookSecret }),
    );
    app.use(gmailRouter);
    app.use(router);
    return app;
}
