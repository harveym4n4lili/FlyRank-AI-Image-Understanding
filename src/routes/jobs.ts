import { Router } from "express";
import { z } from "zod";
import { workspaceOf } from "../http/auth.js";
import type { IngestionService } from "../services/ingestion.js";
import type { PostsService } from "../services/posts.js";

const IngestBody = z
  .object({
    dir: z
      .string()
      .regex(/^[A-Za-z0-9_\-/]+$/, "letters, digits, -, _ and / only")
      .max(200)
      .default("images"),
  })
  .strict();

const JobParams = z.object({ id: z.uuid() });

const EmptyBody = z.object({}).strict();

export function jobsRouter(ingestion: IngestionService, posts: PostsService) {
  const router = Router();

  router.post("/jobs/ingest-images", async (req, res) => {
    const body = IngestBody.parse(req.body ?? {});
    const result = await ingestion.startBatch(workspaceOf(res), body.dir);
    res.status(202).json(result);
  });

  // Backfill: embed tagged/flagged images that have no embedding yet.
  router.post("/jobs/embed-images", async (req, res) => {
    EmptyBody.parse(req.body ?? {});
    res.status(202).json(await posts.enqueueMissingImageEmbeddings(workspaceOf(res)));
  });

  // Re-queue posts that are still pending or failed (subject extraction + embedding).
  router.post("/jobs/embed-posts", async (req, res) => {
    EmptyBody.parse(req.body ?? {});
    res.status(202).json(await posts.enqueuePendingPosts(workspaceOf(res)));
  });

  router.get("/jobs/:id", async (req, res) => {
    const { id } = JobParams.parse(req.params);
    res.json(await ingestion.batchProgress(workspaceOf(res), id));
  });

  return router;
}
