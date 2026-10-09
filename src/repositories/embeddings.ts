import { and, asc, cosineDistance, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { imageEmbeddings, images } from "../db/schema.js";

export function embeddingsRepo(db: Db) {
  return {
    async getImageEmbedding(imageId: string) {
      const [row] = await db
        .select({ model: imageEmbeddings.model, inputText: imageEmbeddings.inputText })
        .from(imageEmbeddings)
        .where(eq(imageEmbeddings.imageId, imageId));
      return row ?? null;
    },

    async saveImageEmbedding(imageId: string, model: string, inputText: string, embedding: number[]) {
      await db
        .insert(imageEmbeddings)
        .values({ imageId, model, inputText, embedding })
        .onConflictDoUpdate({ target: imageEmbeddings.imageId, set: { model, inputText, embedding } });
    },

    // Tagged or flagged images that have no embedding yet (backfill for POST /jobs/embed-images).
    async imagesMissingEmbedding(workspaceId: string) {
      return db
        .select({ id: images.id })
        .from(images)
        .leftJoin(imageEmbeddings, eq(imageEmbeddings.imageId, images.id))
        .where(
          and(eq(images.workspaceId, workspaceId), inArray(images.status, ["tagged", "flagged"]), isNull(imageEmbeddings.imageId)),
        );
    },

    // Nearest images to a post vector by cosine distance (uses the HNSW index). Flagged images are
    // included on purpose: the guard rejects them with a reason instead of hiding them.
    async rankImages(workspaceId: string, postVector: number[], limit: number) {
      const distance = cosineDistance(imageEmbeddings.embedding, postVector);
      return db
        .select({
          imageId: images.id,
          filePath: images.filePath,
          status: images.status,
          subject: images.subject,
          subjectLabel: images.subjectLabel,
          category: images.category,
          confidence: images.confidence,
          caption: images.caption,
          similarity: sql<number>`1 - (${distance})`.mapWith(Number),
        })
        .from(imageEmbeddings)
        .innerJoin(images, eq(images.id, imageEmbeddings.imageId))
        .where(eq(images.workspaceId, workspaceId))
        .orderBy(asc(distance))
        .limit(limit);
    },

    // Similarity of one specific image to the post (for the forced-candidate check).
    async similarityOf(workspaceId: string, postVector: number[], imageId: string) {
      const [row] = await db
        .select({
          imageId: images.id,
          filePath: images.filePath,
          status: images.status,
          subject: images.subject,
          subjectLabel: images.subjectLabel,
          category: images.category,
          confidence: images.confidence,
          caption: images.caption,
          similarity: sql<number>`1 - (${cosineDistance(imageEmbeddings.embedding, postVector)})`.mapWith(Number),
        })
        .from(imageEmbeddings)
        .innerJoin(images, eq(images.id, imageEmbeddings.imageId))
        .where(and(eq(images.workspaceId, workspaceId), eq(images.id, imageId)));
      return row ?? null;
    },
  };
}

export type EmbeddingsRepo = ReturnType<typeof embeddingsRepo>;
