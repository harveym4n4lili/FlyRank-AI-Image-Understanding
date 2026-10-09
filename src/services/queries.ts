import type { BudgetLimits } from "../domain/budget.js";
import { AppError } from "../lib/errors.js";
import type { AiCallKind, AiCallsRepo } from "../repositories/aiCalls.js";
import type { ImageStatus, ImagesRepo } from "../repositories/images.js";

// Read-side operations behind GET /images and GET /costs.
export function queryService(deps: { images: ImagesRepo; aiCalls: AiCallsRepo; limits: BudgetLimits }) {
  return {
    listImages: (workspaceId: string, filters: { status?: ImageStatus; label?: string; limit: number; offset: number }) =>
      deps.images.list(workspaceId, filters),

    async getImage(workspaceId: string, imageId: string) {
      const image = await deps.images.findById(imageId, workspaceId);
      if (!image) throw new AppError(404, "NOT_FOUND", "No such image");
      const { rawResponse: _raw, contentHash: _hash, ...rest } = image;
      return rest;
    },

    listCosts: (workspaceId: string, filters: { kind?: AiCallKind; limit: number }) =>
      deps.aiCalls.list(workspaceId, filters),

    async costSummary(workspaceId: string) {
      const [rows, today] = await Promise.all([deps.aiCalls.summary(workspaceId), deps.aiCalls.spentToday(workspaceId)]);
      const totals = rows.reduce(
        (t, r) => ({
          calls: t.calls + r.calls,
          costUsd: t.costUsd + r.costUsd,
          billedUsd: t.billedUsd + r.billedUsd,
        }),
        { calls: 0, costUsd: 0, billedUsd: 0 },
      );
      return {
        totals,
        byKindModelOutcome: rows,
        budget: {
          window: "UTC day",
          maxUsd: deps.limits.maxUsdPerDay,
          maxCalls: deps.limits.maxCallsPerDay,
          usedUsd: today.usd,
          usedCalls: today.calls,
          remainingUsd: Math.max(0, deps.limits.maxUsdPerDay - today.usd),
          remainingCalls: Math.max(0, deps.limits.maxCallsPerDay - today.calls),
        },
      };
    },
  };
}

export type QueryService = ReturnType<typeof queryService>;
