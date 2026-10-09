import express from "express";
import { EnvConfig } from "./config";
import { loadHandlers } from "./bot/loadHandlers";
import router from "./auth/routes";
import { gmailRouter } from "./gmail/routes";
import { PUBLIC_DIR } from "./constants";
import { startScheduler, stopScheduler } from "./scheduler";
import { runCatchUpPass } from "./scheduler/jobs/catchUpPass";
import { announceRestart } from "./startup/announceRestart";

const app = express();

app.get("/", (_req, res) => {
  res.send("Hello World!");
});

loadHandlers();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use(gmailRouter);
app.use(router);
const server = app.listen(EnvConfig.port, async () => {
  console.log(`Example app running`);
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

function shutdown(signal: string) {
  console.log({ event: "shutdown", signal });
  stopScheduler();
  server.close(() => process.exit(0));
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));