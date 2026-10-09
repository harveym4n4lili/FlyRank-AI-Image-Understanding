import { loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";

const env = loadEnv();
const database = createDb(env.DATABASE_URL);
const app = createApp({ checkDb: database.ping });

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "api listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "api shutting down");
  server.close();
  await database.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
