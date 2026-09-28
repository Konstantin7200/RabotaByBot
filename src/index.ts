import express from "express";
import { EnvConfig } from "./config";
import { loadHandlers } from "./bot/loadHandlers";
import router from "./auth/routes";

const app = express();

app.get("/", (_req, res) => {
  res.send("Hello World!");
});

loadHandlers();
app.use(router);
app.listen(EnvConfig.port, () => {
  console.log(`Example app running`);
});