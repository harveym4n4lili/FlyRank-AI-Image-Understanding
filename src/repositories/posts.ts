import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { postEmbeddings, posts } from "../db/schema.js";
import type { PostSubject } from "../domain/postSubject.js";

export function postsRepo(db: Db) {
  return {
    // Idempotent on (workspace, slug): returns the existing post instead of creating a duplicate.
    async createOrGet(workspaceId: string, input: { slug: string; title: string; body: string }) {
      const [inserted] = await db
        .insert(posts)
        .values({ workspaceId, ...input })
        .onConflictDoNothing({ target: [posts.workspaceId, posts.slug] })
        .returning();
      if (inserted) return { post: inserted, created: true };
      const [existing] = await db
        .select()
        .from(posts)
        .where(and(eq(posts.workspaceId, workspaceId), eq(posts.slug, input.slug)));
      return { post: existing!, created: false };
    },

    async findById(postId: string, workspaceId?: string) {
      const where = workspaceId ? and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)) : eq(posts.id, postId);
      const [row] = await db.select().from(posts).where(where);
      return row ?? null;
    },

    async list(workspaceId: string, limit: number) {
      return db
        .select({
          id: posts.id,
          slug: posts.slug,
          title: posts.title,
          status: posts.status,
          subject: posts.subject,
          subjectLabel: posts.subjectLabel,
          category: posts.category,
        })
        .from(posts)
        .where(eq(posts.workspaceId, workspaceId))
        .orderBy(desc(posts.createdAt))
        .limit(limit);
    },

    async needingProcessing(workspaceId: string) {
      return db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.workspaceId, workspaceId), inArray(posts.status, ["pending", "failed"])));
    },

    async startAttempt(postId: string) {
      await db
        .update(posts)
        .set({ attempts: sql`${posts.attempts} + 1` })
        .where(eq(posts.id, postId));
    },

    async saveSubject(postId: string, subject: PostSubject) {
      await db
        .update(posts)
        .set({ subject: subject.subject, subjectLabel: subject.subject_label, category: subject.category })
        .where(eq(posts.id, postId));
    },

    async saveEmbedding(postId: string, model: string, inputText: string, embedding: number[]) {
      await db.transaction(async (tx) => {
        await tx
          .insert(postEmbeddings)
          .values({ postId, model, inputText, embedding })
          .onConflictDoUpdate({ target: postEmbeddings.postId, set: { model, inputText, embedding } });
        await tx.update(posts).set({ status: "embedded", lastError: null }).where(eq(posts.id, postId));
      });
    },

    async recordError(postId: string, error: string) {
      await db.update(posts).set({ lastError: error }).where(eq(posts.id, postId));
    },

    async markFailed(postId: string, reason: string) {
      await db.update(posts).set({ status: "failed", lastError: reason }).where(eq(posts.id, postId));
    },

    async getEmbedding(postId: string) {
      const [row] = await db.select().from(postEmbeddings).where(eq(postEmbeddings.postId, postId));
      return row ?? null;
    },
  };
}

export type PostsRepo = ReturnType<typeof postsRepo>;
