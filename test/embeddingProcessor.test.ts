import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider, PostSubjectProvider } from "../src/providers/gemini.js";
import type { EmbeddingsRepo } from "../src/repositories/embeddings.js";
import type { ImagesRepo } from "../src/repositories/images.js";
import type { PostsRepo } from "../src/repositories/posts.js";
import type { CostTracker } from "../src/services/costTracker.js";
import { embeddingProcessor } from "../src/services/embeddingProcessor.js";
import { InvalidModelOutputError } from "../src/services/imageProcessor.js";

const usage = { inputTokens: 40, outputTokens: 0 };
const ctx = { jobId: "job-1", attempt: 1 };
const basePost = { id: "post-1", workspaceId: "ws-1", title: "Red foxes", body: "All about red foxes.", status: "pending", subjectLabel: null };

function setup(opts: { post?: Record<string, unknown>; extractText?: string; image?: Record<string, unknown> | null; existing?: unknown } = {}) {
  const posts = {
    findById: vi.fn(async () => ({ ...basePost, ...opts.post })),
    startAttempt: vi.fn(),
    saveSubject: vi.fn(),
    saveEmbedding: vi.fn(),
    recordError: vi.fn(),
    markFailed: vi.fn(),
  } as unknown as PostsRepo;
  const images = {
    findById: vi.fn(async () =>
      opts.image === null
        ? null
        : { id: "img-1", workspaceId: "ws-1", status: "tagged", subject: "red fox", caption: "A red fox in a forest", attributes: ["orange fur"], ...opts.image },
    ),
    setLastError: vi.fn(),
  } as unknown as ImagesRepo;
  const embeddings = {
    getImageEmbedding: vi.fn(async () => opts.existing ?? null),
    saveImageEmbedding: vi.fn(),
  } as unknown as EmbeddingsRepo;
  const embedder: EmbeddingProvider = { model: "embed-model", embed: vi.fn(async () => ({ values: [1, 0], usage, latencyMs: 5 })) };
  const extractor: PostSubjectProvider = {
    model: "flash-model",
    extractPostSubject: vi.fn(async () => ({
      text: opts.extractText ?? JSON.stringify({ subject: "red fox", subject_label: "red_fox", category: "animal" }),
      usage,
      latencyMs: 5,
    })),
  };
  const tracker = { ensureBudget: vi.fn(), record: vi.fn() } as unknown as CostTracker;
  return { processor: embeddingProcessor({ images, posts, embeddings, embedder, extractor, tracker }), posts, images, embeddings, embedder, extractor, tracker };
}

describe("embeddingProcessor.processPost", () => {
  beforeEach(() => vi.clearAllMocks());

  it("extracts the subject, embeds the post and logs both calls", async () => {
    const { processor, posts, tracker } = setup();
    expect(await processor.processPost("post-1", ctx)).toEqual({ embedded: true, label: "red_fox" });
    expect(posts.saveSubject).toHaveBeenCalledWith("post-1", { subject: "red fox", subject_label: "red_fox", category: "animal" });
    expect(posts.saveEmbedding).toHaveBeenCalledWith("post-1", "embed-model", "Red foxes\n\nAll about red foxes.", [1, 0]);
    const kinds = vi.mocked(tracker.record).mock.calls.map(([meta, rec]) => [meta.kind, rec.outcome]);
    expect(kinds).toEqual([["post_extract", "ok"], ["embed", "ok"]]);
  });

  it("never saves an invalid subject: logs it and throws for a retry", async () => {
    const { processor, posts, embedder } = setup({ extractText: '{"subject":"fox","subject_label":"coyote","category":"animal"}' });
    await expect(processor.processPost("post-1", ctx)).rejects.toBeInstanceOf(InvalidModelOutputError);
    expect(posts.saveSubject).not.toHaveBeenCalled();
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it("on a retry, reuses the saved subject instead of paying for extraction again", async () => {
    const { processor, extractor, posts } = setup({ post: { subjectLabel: "red_fox" } });
    await processor.processPost("post-1", ctx);
    expect(extractor.extractPostSubject).not.toHaveBeenCalled();
    expect(posts.saveEmbedding).toHaveBeenCalled();
  });

  it("skips posts that are already embedded", async () => {
    const { processor, extractor } = setup({ post: { status: "embedded" } });
    expect(await processor.processPost("post-1", ctx)).toEqual({ skipped: "already embedded" });
    expect(extractor.extractPostSubject).not.toHaveBeenCalled();
  });
});

describe("embeddingProcessor.embedImage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("embeds subject + caption + attributes", async () => {
    const { processor, embeddings, embedder } = setup();
    await processor.embedImage("img-1", ctx);
    expect(embedder.embed).toHaveBeenCalledWith("red fox. A red fox in a forest. Attributes: orange fur.");
    expect(embeddings.saveImageEmbedding).toHaveBeenCalled();
  });

  it("is idempotent when the same text was already embedded with the same model", async () => {
    const { processor, embedder } = setup({
      existing: { model: "embed-model", inputText: "red fox. A red fox in a forest. Attributes: orange fur." },
    });
    expect(await processor.embedImage("img-1", ctx)).toEqual({ skipped: "already embedded" });
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it("does not embed images that were never tagged", async () => {
    const { processor, embedder } = setup({ image: { status: "failed" } });
    expect(await processor.embedImage("img-1", ctx)).toEqual({ skipped: "image is failed" });
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it("marking an embedding failure keeps the image's tags (status untouched)", async () => {
    const { processor, images } = setup();
    await processor.markImageEmbeddingFailed("img-1", "boom");
    expect(images.setLastError).toHaveBeenCalledWith("img-1", "boom");
  });
});
