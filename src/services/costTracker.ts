import { costUsd } from "../config/pricing.js";
import { BudgetExceededError, checkBudget, type BudgetLimits } from "../domain/budget.js";
import type { Usage } from "../providers/gemini.js";
import type { AiCallKind, AiCallsRepo } from "../repositories/aiCalls.js";

export interface CallMeta {
  workspaceId: string;
  kind: AiCallKind;
  model: string;
  subjectType: "image" | "post";
  subjectId: string;
  jobId?: string;
  attempt: number;
}

export interface CallRecord {
  outcome: "ok" | "invalid_output" | "error";
  usage?: Usage;
  latencyMs?: number;
  error?: string;
}

// Every AI call goes through here: budget check before, one ai_calls row after — whatever the outcome.
export function costTracker(aiCalls: AiCallsRepo, limits: BudgetLimits) {
  return {
    async ensureBudget(meta: CallMeta): Promise<void> {
      const verdict = checkBudget(await aiCalls.spentToday(meta.workspaceId), limits);
      if (verdict.allowed) return;
      await aiCalls.insert({ ...meta, outcome: "budget_blocked", error: verdict.reason });
      throw new BudgetExceededError(verdict.reason);
    },

    async record(meta: CallMeta, rec: CallRecord): Promise<void> {
      const inputTokens = rec.usage?.inputTokens ?? 0;
      const outputTokens = rec.usage?.outputTokens ?? 0;
      await aiCalls.insert({
        ...meta,
        inputTokens,
        outputTokens,
        costUsd: costUsd(meta.model, inputTokens, outputTokens),
        billedUsd: 0, // free tier
        latencyMs: rec.latencyMs ?? 0,
        outcome: rec.outcome,
        error: rec.error?.slice(0, 1000),
      });
    },
  };
}

export type CostTracker = ReturnType<typeof costTracker>;
