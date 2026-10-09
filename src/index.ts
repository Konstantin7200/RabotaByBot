import { EnvConfig } from "./config";
import { getBot } from "./bot";
import { createApp } from "./app";
import { startScheduler, stopScheduler, waitForIdleJobs } from "./scheduler";
import { runCatchUpPass } from "./scheduler/jobs/catchUpPass";
import { announceRestart } from "./startup/announceRestart";

const app = createApp();
const server = app.listen(EnvConfig.port, async () => {
  console.log({ event: "server_listening", port: EnvConfig.port });
  try {
    await getBot().api.setWebhook(`${EnvConfig.publicBaseUrl}/telegram/webhook`, {
      secret_token: EnvConfig.telegramWebhookSecret,
    });
    console.log({ event: "telegram_webhook_set", url: `${EnvConfig.publicBaseUrl}/telegram/webhook` });
  } catch (err) {
    console.log({ event: "telegram_webhook_set_failed", err: String(err) });
  }
  let wasDown = false;
  try {
    wasDown = await announceRestart();
  } catch (err) {
    console.log({ event: "announce_restart_failed", err: String(err) });
  }
  if (wasDown)
    void runCatchUpPass().catch((err) =>
      console.log({ event: "catch_up_startup_failed", err: String(err) }));
  startScheduler();
});

async function shutdown(signal: string) {
  console.log({ event: "shutdown", signal });
  stopScheduler();
  await waitForIdleJobs(5_000);
  console.log({ event: "shutdown_drained" });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
