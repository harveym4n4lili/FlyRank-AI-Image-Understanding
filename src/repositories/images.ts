import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { images, imageTags, ingestBatches } from "../db/schema.js";
import type { ImageTags } from "../domain/imageTags.js";

export type ImageStatus = (typeof images.status.enumValues)[number];

export function imagesRepo(db: Db) {
  return {
    // Inserts the file if its bytes are new to this workspace; returns the row either way.
    async upsertByHash(workspaceId: string, filePath: string, contentHash: string) {
      const [inserted] = await db
        .insert(images)
        .values({ workspaceId, filePath, contentHash })
        .onConflictDoNothing({ target: [images.workspaceId, images.contentHash] })
        .returning();
      if (inserted) return inserted;
      const [existing] = await db
        .select()
        .from(images)
        .where(and(eq(images.workspaceId, workspaceId), eq(images.contentHash, contentHash)));
      return existing!;
    },

    async createBatch(workspaceId: string, dir: string, total: number, enqueued: number) {
      const [row] = await db.insert(ingestBatches).values({ workspaceId, dir, total, enqueued }).returning();
      return row!;
    },

    async assignToBatch(imageIds: string[], batchId: string) {
      if (imageIds.length === 0) return;
      await db
        .update(images)
        .set({ batchId, status: "pending", lastError: null })
        .where(and(inArray(images.id, imageIds), inArray(images.status, ["pending", "failed"])));
    },

    async findBatch(workspaceId: string, batchId: string) {
      const [batch] = await db
        .select()
        .from(ingestBatches)
        .where(and(eq(ingestBatches.id, batchId), eq(ingestBatches.workspaceId, workspaceId)));
      if (!batch) return null;
      const rows = await db
        .select({ status: images.status, n: count() })
        .from(images)
        .where(eq(images.batchId, batchId))
        .groupBy(images.status);
      const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<ImageStatus, number>>;
      return { batch, byStatus };
    },

    async findById(imageId: string, workspaceId?: string) {
      const where = workspaceId
        ? and(eq(images.id, imageId), eq(images.workspaceId, workspaceId))
        : eq(images.id, imageId);
      const [row] = await db.select().from(images).where(where);
      if (!row) return null;
      const tags = await db.select({ tag: imageTags.tag }).from(imageTags).where(eq(imageTags.imageId, imageId));
      return { ...row, attributes: tags.map((t) => t.tag) };
    },

    async list(workspaceId: string, filters: { status?: ImageStatus; label?: string; limit: number; offset: number }) {
      const conditions = [eq(images.workspaceId, workspaceId)];
      if (filters.status) conditions.push(eq(images.status, filters.status));
      if (filters.label) conditions.push(eq(images.subjectLabel, filters.label));
      return db
        .select({
          id: images.id,
          filePath: images.filePath,
          status: images.status,
          flagReason: images.flagReason,
          subject: images.subject,
          subjectLabel: images.subjectLabel,
          category: images.category,
          confidence: images.confidence,
          caption: images.caption,
          attempts: images.attempts,
        })
        .from(images)
        .where(and(...conditions))
        .orderBy(asc(images.filePath))
        .limit(filters.limit)
        .offset(filters.offset);
    },

    async markProcessing(imageId: string) {
      const [row] = await db
        .update(images)
        .set({ status: "processing", attempts: sql`${images.attempts} + 1` })
        .where(eq(images.id, imageId))
        .returning();
      return row!;
    },

    async recordAttemptError(imageId: string, error: string, rawResponse: unknown) {
      await db
        .update(images)
        .set({ status: "pending", lastError: error, rawResponse: rawResponse ?? null })
        .where(eq(images.id, imageId));
    },

    // Stores validated tags and the flag decision atomically with the attribute rows.
    async saveTags(
      imageId: string,
      tags: ImageTags,
      decision: { status: "tagged" | "flagged"; flagReason: string | null },
      rawResponse: unknown,
    ) {
      await db.transaction(async (tx) => {
        await tx
          .update(images)
          .set({
            status: decision.status,
            flagReason: decision.flagReason,
            subject: tags.subject,
            subjectLabel: tags.subject_label,
            category: tags.category,
            caption: tags.caption,
            confidence: tags.confidence,
            rawResponse,
            lastError: null,
          })
          .where(eq(images.id, imageId));
        await tx.delete(imageTags).where(eq(imageTags.imageId, imageId));
        await tx
          .insert(imageTags)
          .values(tags.attributes.map((tag) => ({ imageId, tag })))
          .onConflictDoNothing();
      });
    },

    async markFailed(imageId: string, reason: string) {
      await db.update(images).set({ status: "failed", lastError: reason }).where(eq(images.id, imageId));
    },
  };
}

export type ImagesRepo = ReturnType<typeof imagesRepo>;
