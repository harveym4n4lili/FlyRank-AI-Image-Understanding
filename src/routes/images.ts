import { Router } from "express";
import { z } from "zod";
import { SUBJECT_LABELS } from "../config/taxonomy.js";
import { imageStatus } from "../db/schema.js";
import { workspaceOf } from "../http/auth.js";
import type { QueryService } from "../services/queries.js";

const ListQuery = z
  .object({
    status: z.enum(imageStatus.enumValues).optional(),
    label: z.enum(SUBJECT_LABELS).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

const ImageParams = z.object({ id: z.uuid() });

export function imagesRouter(queries: QueryService) {
  const router = Router();

  router.get("/images", async (req, res) => {
    const filters = ListQuery.parse(req.query);
    const items = await queries.listImages(workspaceOf(res), filters);
    res.json({ count: items.length, items });
  });

  router.get("/images/:id/file", async (req, res) => {
    const { id } = ImageParams.parse(req.params);
    res.sendFile(await queries.imageFilePath(workspaceOf(res), id), { headers: { "Cache-Control": "private, max-age=3600" } });
  });

  router.get("/images/:id", async (req, res) => {
    const { id } = ImageParams.parse(req.params);
    res.json(await queries.getImage(workspaceOf(res), id));
  });

  return router;
}
