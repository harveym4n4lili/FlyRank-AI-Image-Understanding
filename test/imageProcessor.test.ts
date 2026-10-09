import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetExceededError } from "../src/domain/budget.js";
import type { VisionProvider, VisionResult } from "../src/providers/gemini.js";
import type { ImagesRepo } from "../src/repositories/images.js";
import type { CostTracker } from "../src/services/costTracker.js";
import { imageProcessor, InvalidModelOutputError } from "../src/services/imageProcessor.js";

const dataDir = mkdtempSync(join(tmpdir(), "imgproc-"));
writeFileSync(join(dataDir, "fox.jpg"), Buffer.from([0xff, 0xd8, 0xff]));

const goodTags = {
  subject: "red fox",
  subject_label: "red_fox",
  category: "animal",
  attributes: ["orange fur"],
  caption: "A red fox standing in a forest",
  confidence: 0.94,
};

function setup(response: VisionResult | Error, status = "pending") {
  const images = {
    findById: vi.fn(async () => ({ id: "img-1", workspaceId: "ws-1", filePath: "fox.jpg", status, attributes: [] })),
    markProcessing: vi.fn(),
    recordAttemptError: vi.fn(),
    saveTags: vi.fn(),
    markFailed: vi.fn(),
  } as unknown as ImagesRepo;
  const tracker = { ensureBudget: vi.fn(), record: vi.fn() } as unknown as CostTracker;
  const vision: VisionProvider = {
    model: "test-model",
    describeImage: vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    }),
  };
  const processor = imageProcessor({ images, vision, tracker, dataDir });
  return { processor, images, tracker, vision };
}

const usage = { inputTokens: 300, outputTokens: 80 };
const ctx = { jobId: "job-1", attempt: 1 };

describe("imageProcessor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores validated tags and records an ok cost entry", async () => {
    const { processor, images, tracker } = setup({ text: JSON.stringify(goodTags), usage, latencyMs: 900 });
    const result = await processor.process("img-1", ctx);

    expect(result).toEqual({ status: "tagged", flagReason: null, label: "red_fox" });
    expect(images.saveTags).toHaveBeenCalledOnce();
    expect(tracker.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "vision", subjectId: "img-1", jobId: "job-1", attempt: 1 }),
      { outcome: "ok", usage, latencyMs: 900 },
    );
  });

  it("flags a low-confidence result instead of accepting it", async () => {
    const { processor, images } = setup({ text: JSON.stringify({ ...goodTags, confidence: 0.4 }), usage, latencyMs: 1 });
    const result = await processor.process("img-1", ctx);
    expect(result.status).toBe("flagged");
    expect(images.saveTags).toHaveBeenCalledWith("img-1", expect.anything(), expect.objectContaining({ status: "flagged" }), expect.anything());
  });

  it("never stores invalid output: records it, then throws so the job retries", async () => {
    const { processor, images, tracker } = setup({ text: '{"subject":"fox"}', usage, latencyMs: 1 });
    await expect(processor.process("img-1", ctx)).rejects.toBeInstanceOf(InvalidModelOutputError);
    expect(images.saveTags).not.toHaveBeenCalled();
    expect(tracker.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ outcome: "invalid_output", usage }));
  });

  it("records a failed model call and rethrows for retry", async () => {
    const { processor, tracker, images } = setup(new Error("503 overloaded"));
    await expect(processor.process("img-1", ctx)).rejects.toThrow("503 overloaded");
    expect(tracker.record).toHaveBeenCalledWith(expect.anything(), { outcome: "error", error: "503 overloaded" });
    expect(images.recordAttemptError).toHaveBeenCalled();
  });

  it("does not call the model when the budget guard blocks", async () => {
    const { processor, tracker, vision } = setup({ text: JSON.stringify(goodTags), usage, latencyMs: 1 });
    vi.mocked(tracker.ensureBudget).mockRejectedValueOnce(new BudgetExceededError("daily call limit reached"));
    await expect(processor.process("img-1", ctx)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(vision.describeImage).not.toHaveBeenCalled();
  });

  it("is idempotent: an already tagged image is skipped without a model call", async () => {
    const { processor, vision } = setup({ text: JSON.stringify(goodTags), usage, latencyMs: 1 }, "tagged");
    expect(await processor.process("img-1", ctx)).toEqual({ skipped: "already tagged" });
    expect(vision.describeImage).not.toHaveBeenCalled();
  });
});
