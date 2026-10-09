import { imageEmbeddingText, parsePostSubject, postEmbeddingText } from "../domain/postSubject.js";
import type { EmbeddingProvider, PostSubjectProvider } from "../providers/gemini.js";
import type { EmbeddingsRepo } from "../repositories/embeddings.js";
import type { ImagesRepo } from "../repositories/images.js";
import type { PostsRepo } from "../repositories/posts.js";
import type { CostTracker } from "./costTracker.js";
import { InvalidModelOutputError, type ProcessContext } from "./imageProcessor.js";

// Worker-side jobs for the matching engine: embed an image, and understand + embed a post.
// Every model call goes through the cost tracker; a failure throws so pg-boss retries.
export function embeddingProcessor(deps: {
  images: ImagesRepo;
  posts: PostsRepo;
  embeddings: EmbeddingsRepo;
  embedder: EmbeddingProvider;
  extractor: PostSubjectProvider;
  tracker: CostTracker;
}) {
  async function embedTracked(
    meta: { workspaceId: string; subjectType: "image" | "post"; subjectId: string },
    text: string,
    ctx: ProcessContext,
  ) {
    const call = { ...meta, kind: "embed" as const, model: deps.embedder.model, jobId: ctx.jobId, attempt: ctx.attempt };
    await deps.tracker.ensureBudget(call);
    try {
      const result = await deps.embedder.embed(text);
      await deps.tracker.record(call, { outcome: "ok", usage: result.usage, latencyMs: result.latencyMs });
      return result.values;
    } catch (err) {
      await deps.tracker.record(call, { outcome: "error", error: (err as Error).message });
      throw err;
    }
  }

  return {
    async embedImage(imageId: string, ctx: ProcessContext) {
      const image = await deps.images.findById(imageId);
      if (!image) return { skipped: "image no longer exists" };
      if (image.status !== "tagged" && image.status !== "flagged") return { skipped: `image is ${image.status}` };

      const text = imageEmbeddingText(image);
      const existing = await deps.embeddings.getImageEmbedding(imageId);
      if (existing && existing.model === deps.embedder.model && existing.inputText === text) {
        return { skipped: "already embedded" };
      }

      const vector = await embedTracked({ workspaceId: image.workspaceId, subjectType: "image", subjectId: image.id }, text, ctx);
      await deps.embeddings.saveImageEmbedding(image.id, deps.embedder.model, text, vector);
      return { embedded: true };
    },

    // Step 1: work out what the post is about (validated, like vision output). Step 2: embed it.
    // A retry after a failed embedding reuses the already-saved subject instead of paying for it again.
    async processPost(postId: string, ctx: ProcessContext) {
      const post = await deps.posts.findById(postId);
      if (!post) return { skipped: "post no longer exists" };
      if (post.status === "embedded") return { skipped: "already embedded" };
      await deps.posts.startAttempt(post.id);

      const meta = { workspaceId: post.workspaceId, subjectType: "post" as const, subjectId: post.id };
      let label = post.subjectLabel;
      if (!label) {
        const call = { ...meta, kind: "post_extract" as const, model: deps.extractor.model, jobId: ctx.jobId, attempt: ctx.attempt };
        await deps.tracker.ensureBudget(call);
        let result;
        try {
          result = await deps.extractor.extractPostSubject(post.title, post.body);
        } catch (err) {
          await deps.tracker.record(call, { outcome: "error", error: (err as Error).message });
          await deps.posts.recordError(post.id, `subject extraction failed: ${(err as Error).message}`);
          throw err;
        }
        const parsed = parsePostSubject(result.text);
        if (!parsed.ok) {
          await deps.tracker.record(call, { outcome: "invalid_output", usage: result.usage, latencyMs: result.latencyMs, error: parsed.error });
          await deps.posts.recordError(post.id, `invalid model output: ${parsed.error}`);
          throw new InvalidModelOutputError(parsed.error);
        }
        await deps.tracker.record(call, { outcome: "ok", usage: result.usage, latencyMs: result.latencyMs });
        await deps.posts.saveSubject(post.id, parsed.value);
        label = parsed.value.subject_label;
      }

      const text = postEmbeddingText(post);
      try {
        const vector = await embedTracked(meta, text, ctx);
        await deps.posts.saveEmbedding(post.id, deps.embedder.model, text, vector);
      } catch (err) {
        await deps.posts.recordError(post.id, `embedding failed: ${(err as Error).message}`);
        throw err;
      }
      return { embedded: true, label };
    },

    // The image keeps its tags; it just has no embedding, so it can't be ranked until re-embedded.
    markImageEmbeddingFailed: (imageId: string, reason: string) => deps.images.setLastError(imageId, reason),
    markPostFailed: (postId: string, reason: string) => deps.posts.markFailed(postId, reason),
  };
}

export type EmbeddingProcessor = ReturnType<typeof embeddingProcessor>;
