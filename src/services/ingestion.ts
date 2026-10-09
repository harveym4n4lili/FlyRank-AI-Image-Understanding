import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { AppError } from "../lib/errors.js";
import type { ImagesRepo } from "../repositories/images.js";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function mimeTypeFor(filePath: string): string | undefined {
  return MIME_TYPES[extname(filePath).toLowerCase()];
}

// Resolves a request-supplied folder against DATA_DIR and refuses anything outside it.
export function resolveInside(dataDir: string, dir: string): string {
  const root = resolve(dataDir);
  const target = resolve(root, dir);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new AppError(400, "INVALID_DIR", "dir must be inside the data directory");
  }
  return target;
}

export interface IngestQueue {
  enqueueImage(data: { imageId: string; workspaceId: string }): Promise<void>;
}

export function ingestionService(deps: { images: ImagesRepo; queue: IngestQueue; dataDir: string }) {
  return {
    // Registers every image in the folder and queues the ones that still need tagging.
    // Re-running is safe: known files (same content hash) that are already tagged or flagged are skipped.
    async startBatch(workspaceId: string, dir: string) {
      const folder = resolveInside(deps.dataDir, dir);
      const entries = await readdir(folder, { withFileTypes: true }).catch(() => {
        throw new AppError(404, "DIR_NOT_FOUND", `No such folder: ${dir}`);
      });
      const files = entries
        .filter((e) => e.isFile() && mimeTypeFor(e.name))
        .map((e) => e.name)
        .sort();
      if (files.length === 0) throw new AppError(422, "NO_IMAGES", `No .jpg/.png/.webp images in ${dir}`);

      const toProcess: string[] = [];
      for (const name of files) {
        const bytes = await readFile(join(folder, name));
        const hash = createHash("sha256").update(bytes).digest("hex");
        const filePath = relative(resolve(deps.dataDir), join(folder, name)).replaceAll("\\", "/");
        const image = await deps.images.upsertByHash(workspaceId, filePath, hash);
        if (image.status === "pending" || image.status === "failed") toProcess.push(image.id);
      }

      const batch = await deps.images.createBatch(workspaceId, dir, files.length, toProcess.length);
      await deps.images.assignToBatch(toProcess, batch.id);
      for (const imageId of toProcess) await deps.queue.enqueueImage({ imageId, workspaceId });

      return { jobId: batch.id, total: files.length, enqueued: toProcess.length, skipped: files.length - toProcess.length };
    },

    async batchProgress(workspaceId: string, batchId: string) {
      const found = await deps.images.findBatch(workspaceId, batchId);
      if (!found) throw new AppError(404, "NOT_FOUND", "No such job");
      const { batch, byStatus } = found;
      const done = (byStatus.tagged ?? 0) + (byStatus.flagged ?? 0);
      const failed = byStatus.failed ?? 0;
      const finished = done + failed;
      return {
        jobId: batch.id,
        state: finished >= batch.enqueued ? "completed" : "running",
        total: batch.total,
        enqueued: batch.enqueued,
        skipped: batch.total - batch.enqueued,
        done,
        tagged: byStatus.tagged ?? 0,
        flagged: byStatus.flagged ?? 0,
        failed,
        inProgress: (byStatus.pending ?? 0) + (byStatus.processing ?? 0),
        progress: batch.enqueued === 0 ? 1 : Number((finished / batch.enqueued).toFixed(3)),
        createdAt: batch.createdAt,
      };
    },
  };
}

export type IngestionService = ReturnType<typeof ingestionService>;
