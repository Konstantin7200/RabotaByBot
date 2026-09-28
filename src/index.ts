import express from "express";
import { EnvConfig } from "./config";
import { loadHandlers } from "./bot";

const app = express();

app.get("/", (_req, res) => {
  res.send("Hello World!");
});

loadHandlers();
app.listen(EnvConfig.port, () => {
  console.log(`Example app running`);
});