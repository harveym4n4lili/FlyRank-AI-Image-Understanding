import { Router } from "express";
import { z } from "zod";
import { reviewStatus, verdict } from "../db/schema.js";
import { workspaceOf } from "../http/auth.js";
import type { ReviewService } from "../services/review.js";

const ReviewQuery = z
  .object({
    status: z.enum(reviewStatus.enumValues).default("pending"),
    verdict: z.enum(verdict.enumValues).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .strict();

const SuggestionParams = z.object({ id: z.uuid() });
const DecisionBody = z.object({ note: z.string().trim().max(500).optional() }).strict();
const IdempotencyKey = z
  .string({ error: "Idempotency-Key header is required" })
  .regex(/^[A-Za-z0-9_\-:.]{8,200}$/, "Idempotency-Key must be 8-200 characters (letters, digits, - _ : .)");

export function reviewRouter(review: ReviewService) {
  const router = Router();

  router.get("/review", async (req, res) => {
    const filters = ReviewQuery.parse(req.query);
    const items = await review.list(workspaceOf(res), filters);
    res.json({ count: items.length, items });
  });

  router.get("/suggestions/:id", async (req, res) => {
    const { id } = SuggestionParams.parse(req.params);
    res.json(await review.explain(workspaceOf(res), id));
  });

  for (const action of ["approve", "reject"] as const) {
    router.post(`/suggestions/:id/${action}`, async (req, res) => {
      const { id } = SuggestionParams.parse(req.params);
      const idempotencyKey = IdempotencyKey.parse(req.header("idempotency-key"));
      const { note } = DecisionBody.parse(req.body ?? {});
      const result = await review.decide({ workspaceId: workspaceOf(res), suggestionId: id, action, note, idempotencyKey });
      res.status(200).json(result);
    });
  }

  return router;
}
