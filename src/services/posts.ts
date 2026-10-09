import type { MatchingQueue } from "../jobs/queues.js";
import { AppError } from "../lib/errors.js";
import type { EmbeddingsRepo } from "../repositories/embeddings.js";
import type { PostsRepo } from "../repositories/posts.js";

export function postsService(deps: { posts: PostsRepo; embeddings: EmbeddingsRepo; queue: MatchingQueue }) {
  return {
    // Idempotent on slug. New (or previously failed) posts are queued for subject extraction + embedding.
    async create(workspaceId: string, input: { slug: string; title: string; body: string }) {
      const { post, created } = await deps.posts.createOrGet(workspaceId, input);
      if (post.status !== "embedded") await deps.queue.enqueuePost(post.id);
      return { post, created };
    },

    async get(workspaceId: string, postId: string) {
      const post = await deps.posts.findById(postId, workspaceId);
      if (!post) throw new AppError(404, "NOT_FOUND", "No such post");
      return post;
    },

    list: (workspaceId: string, limit: number) => deps.posts.list(workspaceId, limit),

    async enqueuePendingPosts(workspaceId: string) {
      const rows = await deps.posts.needingProcessing(workspaceId);
      for (const { id } of rows) await deps.queue.enqueuePost(id);
      return { enqueued: rows.length };
    },

    // Backfill: embeds tagged/flagged images that were processed before embeddings existed.
    async enqueueMissingImageEmbeddings(workspaceId: string) {
      const rows = await deps.embeddings.imagesMissingEmbedding(workspaceId);
      for (const { id } of rows) await deps.queue.enqueueImageEmbedding(id);
      return { enqueued: rows.length };
    },
  };
}

export type PostsService = ReturnType<typeof postsService>;
