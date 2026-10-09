import { loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";
import { createApp } from "./app.js";
import { ingestQueue, startBoss } from "./jobs/queues.js";
import { logger } from "./lib/logger.js";
import { aiCallsRepo } from "./repositories/aiCalls.js";
import { imagesRepo } from "./repositories/images.js";
import { workspacesRepo } from "./repositories/workspaces.js";
import { ingestionService } from "./services/ingestion.js";
import { queryService } from "./services/queries.js";

const env = loadEnv();
const database = createDb(env.DATABASE_URL);
const boss = await startBoss(env.DATABASE_URL);
boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

const images = imagesRepo(database.db);
const workspaces = workspacesRepo(database.db);

const app = createApp({
  checkDb: database.ping,
  resolveWorkspace: async (hash) => (await workspaces.findByKeyHash(hash))?.id ?? null,
  ingestion: ingestionService({ images, queue: ingestQueue(boss), dataDir: env.DATA_DIR }),
  queries: queryService({
    images,
    aiCalls: aiCallsRepo(database.db),
    limits: { maxUsdPerDay: env.AI_BUDGET_USD, maxCallsPerDay: env.AI_MAX_CALLS_PER_DAY },
  }),
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "api listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "api shutting down");
  server.close();
  await boss.stop({ graceful: true });
  await database.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
