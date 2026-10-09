// Applies the SQL migrations in drizzle/ (run once before api/worker start; see docker-compose.yml).
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadEnv } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { createDb } from "./client.js";

const database = createDb(loadEnv().DATABASE_URL);
try {
  await migrate(database.db, { migrationsFolder: "drizzle" });
  logger.info("migrations applied");
} finally {
  await database.close();
}
