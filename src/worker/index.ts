import { loadEnv } from "../config/env.js";
import { createDb } from "../db/client.js";
import { BudgetExceededError } from "../domain/budget.js";
import { INGEST_RETRY, QUEUES, startBoss, type IngestImageJob } from "../jobs/queues.js";
import { createAlerter } from "../lib/alert.js";
import { logger } from "../lib/logger.js";
import { GeminiVisionProvider } from "../providers/gemini.js";
import { aiCallsRepo } from "../repositories/aiCalls.js";
import { imagesRepo } from "../repositories/images.js";
import { costTracker } from "../services/costTracker.js";
import { imageProcessor } from "../services/imageProcessor.js";

const env = loadEnv();
if (!env.GEMINI_API_KEY || !env.GEMINI_VISION_MODEL) {
  throw new Error("GEMINI_API_KEY and GEMINI_VISION_MODEL must be set for the worker");
}

const database = createDb(env.DATABASE_URL);
const alert = createAlerter(env.ALERT_WEBHOOK_URL);
const processor = imageProcessor({
  images: imagesRepo(database.db),
  vision: new GeminiVisionProvider(env.GEMINI_API_KEY, env.GEMINI_VISION_MODEL, env.GEMINI_MAX_RPM),
  tracker: costTracker(aiCallsRepo(database.db), {
    maxUsdPerDay: env.AI_BUDGET_USD,
    maxCallsPerDay: env.AI_MAX_CALLS_PER_DAY,
  }),
  dataDir: env.DATA_DIR,
});

const boss = await startBoss(env.DATABASE_URL);
boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

// One image at a time: vision calls are rate-limited anyway, and this keeps the free tier happy.
await boss.work<IngestImageJob>(QUEUES.ingestImage, { batchSize: 1, localConcurrency: 1 }, async ([job]) => {
  if (!job) return;
  const attempt = job.retryCount + 1;
  const log = logger.child({ jobId: job.id, imageId: job.data.imageId, attempt });
  try {
    const result = await processor.process(job.data.imageId, { jobId: job.id, attempt });
    log.info(result, "image processed");
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      // Retrying cannot help until the budget resets, so fail the image now instead of retrying.
      await processor.markFailed(job.data.imageId, err.message);
      await alert("AI budget exhausted; image ingestion stopped", { imageId: job.data.imageId, reason: err.message });
      return;
    }
    const retriesLeft = INGEST_RETRY.retryLimit - job.retryCount;
    log.warn(
      { err: (err as Error).message, retriesLeft },
      retriesLeft > 0 ? "image attempt failed; will retry" : "image attempt failed; no retries left, moving to dead-letter queue",
    );
    throw err;
  }
});

// Jobs land here once all retries are used up.
await boss.work<IngestImageJob>(QUEUES.ingestImageDead, async ([job]) => {
  if (!job) return;
  await processor.markFailed(job.data.imageId, "failed after all retries (see last_error and ai_calls)");
  await alert("image ingestion failed after all retries", { imageId: job.data.imageId, deadLetterJobId: job.id });
});

logger.info({ model: env.GEMINI_VISION_MODEL, maxRpm: env.GEMINI_MAX_RPM }, "worker started");

async function shutdown(signal: string) {
  logger.info({ signal }, "worker shutting down");
  await boss.stop({ graceful: true });
  await database.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
