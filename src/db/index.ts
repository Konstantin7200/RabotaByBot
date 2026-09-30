import { drizzle } from "drizzle-orm/singlestore";
import { EnvConfig } from "../config";

export const db=drizzle(EnvConfig.database.databaseUrl);