import type { Job, PgBoss } from "pg-boss";
import { loadEnv } from "../config/env.js";
import { createDb } from "../db/client.js";
import { BudgetExceededError } from "../domain/budget.js";
import {
  INGEST_RETRY,
  matchingQueue,
  QUEUES,
  startBoss,
  type EmbedImageJob,
  type IngestImageJob,
  type ProcessPostJob,
} from "../jobs/queues.js";
import { createAlerter, type Alert } from "../lib/alert.js";
import { logger } from "../lib/logger.js";
import { GeminiEmbeddingProvider, GeminiFlashProvider } from "../providers/gemini.js";
import { aiCallsRepo } from "../repositories/aiCalls.js";
import { embeddingsRepo } from "../repositories/embeddings.js";
import { imagesRepo } from "../repositories/images.js";
import { postsRepo } from "../repositories/posts.js";
import { costTracker } from "../services/costTracker.js";
import { embeddingProcessor } from "../services/embeddingProcessor.js";
import { imageProcessor } from "../services/imageProcessor.js";

const env = loadEnv();
if (!env.GEMINI_API_KEY || !env.GEMINI_VISION_MODEL || !env.GEMINI_EMBED_MODEL) {
  throw new Error("GEMINI_API_KEY, GEMINI_VISION_MODEL and GEMINI_EMBED_MODEL must be set for the worker");
}

const database = createDb(env.DATABASE_URL);
const alert = createAlerter(env.ALERT_WEBHOOK_URL);
const boss = await startBoss(env.DATABASE_URL);
boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

const images = imagesRepo(database.db);
const tracker = costTracker(aiCallsRepo(database.db), {
  maxUsdPerDay: env.AI_BUDGET_USD,
  maxCallsPerDay: env.AI_MAX_CALLS_PER_DAY,
});
const flash = new GeminiFlashProvider(env.GEMINI_API_KEY, env.GEMINI_VISION_MODEL, env.GEMINI_MAX_RPM);
const queue = matchingQueue(boss);

const tagger = imageProcessor({
  images,
  vision: flash,
  tracker,
  dataDir: env.DATA_DIR,
  onTagged: (imageId) => queue.enqueueImageEmbedding(imageId),
});
const embedder = embeddingProcessor({
  images,
  posts: postsRepo(database.db),
  embeddings: embeddingsRepo(database.db),
  embedder: new GeminiEmbeddingProvider(env.GEMINI_API_KEY, env.GEMINI_EMBED_MODEL, env.GEMINI_EMBED_MAX_RPM),
  extractor: flash,
  tracker,
});

interface QueueSpec<T> {
  queue: string;
  deadQueue: string;
  idOf: (data: T) => string;
  run: (data: T, ctx: { jobId: string; attempt: number }) => Promise<unknown>;
  markFailed: (id: string, reason: string) => Promise<unknown>;
}

// Shared job handling: one item at a time, retry on failure, fail fast when the budget is exhausted,
// and mark + alert when the dead-letter queue receives an item that used up its retries.
async function register<T extends object>(boss: PgBoss, alert: Alert, spec: QueueSpec<T>) {
  await boss.work<T>(spec.queue, { batchSize: 1, localConcurrency: 1 }, async ([job]: Job<T>[]) => {
    if (!job) return;
    const id = spec.idOf(job.data);
    const attempt = job.retryCount + 1;
    const log = logger.child({ queue: spec.queue, jobId: job.id, itemId: id, attempt });
    try {
      const result = await spec.run(job.data, { jobId: job.id, attempt });
      log.info(result as object, "job done");
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        // Retrying cannot help until the budget resets, so fail now instead of retrying.
        await spec.markFailed(id, err.message);
        await alert("AI budget exhausted; job stopped", { queue: spec.queue, itemId: id, reason: err.message });
        return;
      }
      const retriesLeft = INGEST_RETRY.retryLimit - job.retryCount;
      log.warn(
        { err: (err as Error).message, retriesLeft },
        retriesLeft > 0 ? "attempt failed; will retry" : "attempt failed; no retries left, moving to dead-letter queue",
      );
      throw err;
    }
  });

  await boss.work<T>(spec.deadQueue, async ([job]: Job<T>[]) => {
    if (!job) return;
    const id = spec.idOf(job.data);
    await spec.markFailed(id, "failed after all retries (see last_error and ai_calls)");
    await alert(`${spec.queue} failed after all retries`, { itemId: id, deadLetterJobId: job.id });
  });
}

await register<IngestImageJob>(boss, alert, {
  queue: QUEUES.ingestImage,
  deadQueue: QUEUES.ingestImageDead,
  idOf: (d) => d.imageId,
  run: (d, ctx) => tagger.process(d.imageId, ctx),
  markFailed: (id, reason) => tagger.markFailed(id, reason),
});

await register<EmbedImageJob>(boss, alert, {
  queue: QUEUES.embedImage,
  deadQueue: QUEUES.embedImageDead,
  idOf: (d) => d.imageId,
  run: (d, ctx) => embedder.embedImage(d.imageId, ctx),
  markFailed: (id, reason) => embedder.markImageEmbeddingFailed(id, reason),
});

await register<ProcessPostJob>(boss, alert, {
  queue: QUEUES.processPost,
  deadQueue: QUEUES.processPostDead,
  idOf: (d) => d.postId,
  run: (d, ctx) => embedder.processPost(d.postId, ctx),
  markFailed: (id, reason) => embedder.markPostFailed(id, reason),
});

logger.info(
  { visionModel: env.GEMINI_VISION_MODEL, embedModel: env.GEMINI_EMBED_MODEL, maxRpm: env.GEMINI_MAX_RPM },
  "worker started",
);

async function shutdown(signal: string) {
  logger.info({ signal }, "worker shutting down");
  await boss.stop({ graceful: true });
  await database.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
