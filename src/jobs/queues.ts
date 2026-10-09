import { PgBoss } from "pg-boss";
import type { IngestQueue } from "../services/ingestion.js";

export const QUEUES = {
  ingestImage: "ingest-image",
  ingestImageDead: "ingest-image-dead",
} as const;

export interface IngestImageJob {
  imageId: string;
  workspaceId: string;
}

// Retry policy for vision calls: 3 retries (4 attempts) with exponential backoff. After the last
// failure the job moves to the dead-letter queue, whose handler marks the image failed and alerts.
export const INGEST_RETRY = { retryLimit: 3, retryDelay: 5, retryBackoff: true, retryDelayMax: 120 } as const;

export async function startBoss(databaseUrl: string): Promise<PgBoss> {
  const boss = new PgBoss(databaseUrl);
  await boss.start();
  await boss.createQueue(QUEUES.ingestImageDead);
  await boss.createQueue(QUEUES.ingestImage, {
    // "stately" + singletonKey = at most one queued and one active job per image, so re-running
    // an ingest batch never duplicates work for an image that is already in flight.
    policy: "stately",
    ...INGEST_RETRY,
    expireInSeconds: 300,
    deadLetter: QUEUES.ingestImageDead,
  });
  return boss;
}

export function ingestQueue(boss: PgBoss): IngestQueue {
  return {
    async enqueueImage(data: IngestImageJob) {
      await boss.send(QUEUES.ingestImage, data, { singletonKey: data.imageId });
    },
  };
}
