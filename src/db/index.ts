import { drizzle } from "drizzle-orm/node-postgres";
import { EnvConfig } from "../config";

export const db=drizzle(EnvConfig.database.databaseUrl);