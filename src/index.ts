import { EnvConfig } from "./config";
import { configureLogger, log } from "./logger";
import { getBot } from "./bot";
import { createApp } from "./app";
import { startScheduler, stopScheduler, waitForIdleJobs } from "./scheduler";
import { runCatchUpPass } from "./scheduler/jobs/catchUpPass";
import { sweepStaleOnBoot } from "./scheduler/jobs/deliverNotifications";
import { announceRestart } from "./startup/announceRestart";

configureLogger(EnvConfig.logLevel);

const app = createApp();
const server = app.listen(EnvConfig.port, async () => {
  log.info({ event: "server_listening", port: EnvConfig.port });
  try {
    await getBot().api.setWebhook(`${EnvConfig.publicBaseUrl}/telegram/webhook`, {
      secret_token: EnvConfig.telegramWebhookSecret,
    });
    log.info({ event: "telegram_webhook_set", url: `${EnvConfig.publicBaseUrl}/telegram/webhook` });
  } catch (err) {
    log.error({ event: "telegram_webhook_set_failed", err: String(err) });
  }
  // M5: sweep and scheduler first - a flaky/unreachable Telegram API must
  // never delay delivery; one announce attempt (attempts: 1), after the
  // pipeline is already up.
  await sweepStaleOnBoot();
  startScheduler();
  let wasDown = false;
  try {
    wasDown = await announceRestart(undefined, { attempts: 1 });
  } catch (err) {
    log.error({ event: "announce_restart_failed", err: String(err) });
  }
  if (wasDown)
    void runCatchUpPass().catch((err) =>
      log.error({ event: "catch_up_startup_failed", err: String(err) }));
});

async function shutdown(signal: string) {
  log.info({ event: "shutdown", signal });
  stopScheduler();
  await waitForIdleJobs(5_000);
  log.info({ event: "shutdown_drained" });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
