import express from "express";
import { EnvConfig } from "./config";
import { loadHandlers } from "./bot/loadHandlers";
import router from "./auth/routes";
import { gmailRouter } from "./gmail/routes";
import { PUBLIC_DIR } from "./constants";
import { startScheduler, stopScheduler } from "./scheduler";

const app = express();

app.get("/", (_req, res) => {
  res.send("Hello World!");
});

loadHandlers();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use(gmailRouter);
app.use(router);
const server = app.listen(EnvConfig.port, () => {
  console.log(`Example app running`);
  startScheduler();
});

function shutdown(signal: string) {
  console.log({ event: "shutdown", signal });
  stopScheduler();
  server.close(() => process.exit(0));
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));