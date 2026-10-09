import { PgBoss } from "pg-boss";
import type { IngestQueue } from "../services/ingestion.js";

export const QUEUES = {
  ingestImage: "ingest-image",
  ingestImageDead: "ingest-image-dead",
  embedImage: "embed-image",
  embedImageDead: "embed-image-dead",
  processPost: "process-post",
  processPostDead: "process-post-dead",
} as const;

export interface IngestImageJob {
  imageId: string;
  workspaceId: string;
}

export interface EmbedImageJob {
  imageId: string;
}

export interface ProcessPostJob {
  postId: string;
}

// Retry policy for every AI job: 3 retries (4 attempts) with exponential backoff. After the last
// failure the job moves to its dead-letter queue, whose handler marks the item failed and alerts.
export const INGEST_RETRY = { retryLimit: 3, retryDelay: 5, retryBackoff: true, retryDelayMax: 120 } as const;

export async function startBoss(databaseUrl: string): Promise<PgBoss> {
  const boss = new PgBoss(databaseUrl);
  await boss.start();
  const pairs = [
    [QUEUES.ingestImage, QUEUES.ingestImageDead],
    [QUEUES.embedImage, QUEUES.embedImageDead],
    [QUEUES.processPost, QUEUES.processPostDead],
  ] as const;
  for (const [queue, dead] of pairs) {
    await boss.createQueue(dead);
    await boss.createQueue(queue, {
      // "stately" + singletonKey = at most one queued and one active job per item, so re-running
      // a batch never duplicates work for an item that is already in flight.
      policy: "stately",
      ...INGEST_RETRY,
      expireInSeconds: 300,
      deadLetter: dead,
    });
  }
  return boss;
}

export function ingestQueue(boss: PgBoss): IngestQueue {
  return {
    async enqueueImage(data: IngestImageJob) {
      await boss.send(QUEUES.ingestImage, data, { singletonKey: data.imageId });
    },
  };
}

export interface MatchingQueue {
  enqueueImageEmbedding(imageId: string): Promise<void>;
  enqueuePost(postId: string): Promise<void>;
}

export function matchingQueue(boss: PgBoss): MatchingQueue {
  return {
    async enqueueImageEmbedding(imageId: string) {
      await boss.send(QUEUES.embedImage, { imageId } satisfies EmbedImageJob, { singletonKey: imageId });
    },
    async enqueuePost(postId: string) {
      await boss.send(QUEUES.processPost, { postId } satisfies ProcessPostJob, { singletonKey: postId });
    },
  };
}
