import { Router } from "express";
import { z } from "zod";
import { workspaceOf } from "../http/auth.js";
import type { IngestionService } from "../services/ingestion.js";

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

export function jobsRouter(ingestion: IngestionService) {
  const router = Router();

  router.post("/jobs/ingest-images", async (req, res) => {
    const body = IngestBody.parse(req.body ?? {});
    const result = await ingestion.startBatch(workspaceOf(res), body.dir);
    res.status(202).json(result);
  });

  router.get("/jobs/:id", async (req, res) => {
    const { id } = JobParams.parse(req.params);
    res.json(await ingestion.batchProgress(workspaceOf(res), id));
  });

  return router;
}
