import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { decideFlag, parseVisionOutput } from "../domain/imageTags.js";
import type { VisionProvider } from "../providers/gemini.js";
import type { ImagesRepo } from "../repositories/images.js";
import type { CostTracker } from "./costTracker.js";
import { mimeTypeFor } from "./ingestion.js";

export class InvalidModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidModelOutputError";
  }
}

export interface ProcessContext {
  jobId?: string;
  attempt: number;
}

export function imageProcessor(deps: {
  images: ImagesRepo;
  vision: VisionProvider;
  tracker: CostTracker;
  dataDir: string;
  /** Called after tags are saved, e.g. to queue the image's embedding job. */
  onTagged?: (imageId: string) => Promise<void>;
}) {
  return {
    // Tags one image. Throws on a model error or invalid output so the job is retried;
    // the response is never stored as tags unless it passes schema validation.
    async process(imageId: string, ctx: ProcessContext) {
      const image = await deps.images.findById(imageId);
      if (!image) return { skipped: "image no longer exists" };
      if (image.status === "tagged" || image.status === "flagged") return { skipped: `already ${image.status}` };

      const mimeType = mimeTypeFor(image.filePath);
      if (!mimeType) throw new Error(`unsupported file type: ${image.filePath}`);
      const bytes = await readFile(join(deps.dataDir, image.filePath));

      const meta = {
        workspaceId: image.workspaceId,
        kind: "vision" as const,
        model: deps.vision.model,
        subjectType: "image" as const,
        subjectId: image.id,
        jobId: ctx.jobId,
        attempt: ctx.attempt,
      };

      await deps.tracker.ensureBudget(meta); // throws BudgetExceededError (not retried)
      await deps.images.markProcessing(image.id);

      let result;
      try {
        result = await deps.vision.describeImage(bytes, mimeType);
      } catch (err) {
        const message = (err as Error).message;
        await deps.tracker.record(meta, { outcome: "error", error: message });
        await deps.images.recordAttemptError(image.id, `model call failed: ${message}`, null);
        throw err;
      }

      const parsed = parseVisionOutput(result.text);
      if (!parsed.ok) {
        await deps.tracker.record(meta, { outcome: "invalid_output", usage: result.usage, latencyMs: result.latencyMs, error: parsed.error });
        await deps.images.recordAttemptError(image.id, `invalid model output: ${parsed.error}`, { text: result.text });
        throw new InvalidModelOutputError(parsed.error);
      }

      await deps.tracker.record(meta, { outcome: "ok", usage: result.usage, latencyMs: result.latencyMs });
      const decision = decideFlag(parsed.tags);
      await deps.images.saveTags(image.id, parsed.tags, decision, parsed.tags);
      await deps.onTagged?.(image.id);
      return { status: decision.status, flagReason: decision.flagReason, label: parsed.tags.subject_label };
    },

    async markFailed(imageId: string, reason: string) {
      await deps.images.markFailed(imageId, reason);
    },
  };
}

export type ImageProcessor = ReturnType<typeof imageProcessor>;
