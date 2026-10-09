import { Router } from "express";
import { z } from "zod";
import { aiCallKind } from "../db/schema.js";
import { workspaceOf } from "../http/auth.js";
import type { QueryService } from "../services/queries.js";

const CostsQuery = z
  .object({
    kind: z.enum(aiCallKind.enumValues).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

export function costsRouter(queries: QueryService) {
  const router = Router();

  router.get("/costs", async (req, res) => {
    const filters = CostsQuery.parse(req.query);
    const items = await queries.listCosts(workspaceOf(res), filters);
    res.json({ count: items.length, items });
  });

  router.get("/costs/summary", async (_req, res) => {
    res.json(await queries.costSummary(workspaceOf(res)));
  });

  return router;
}
