import { PgBoss } from "pg-boss";
import { loadEnv } from "../config/env.js";
import { logger } from "../lib/logger.js";

// Background worker entry point. Job handlers (ingest-image, embed-image, embed-post)
// are registered here starting in Phase 2.
const env = loadEnv();
const boss = new PgBoss(env.DATABASE_URL);

boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

await boss.start();
logger.info("worker started");

async function shutdown(signal: string) {
  logger.info({ signal }, "worker shutting down");
  await boss.stop({ graceful: true });
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
