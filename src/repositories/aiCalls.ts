import { and, count, desc, eq, gte, ne, sql, sum } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { aiCalls } from "../db/schema.js";

export type NewAiCall = typeof aiCalls.$inferInsert;
export type AiCallKind = (typeof aiCalls.kind.enumValues)[number];

function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function aiCallsRepo(db: Db) {
  return {
    async insert(call: NewAiCall) {
      await db.insert(aiCalls).values(call);
    },

    // Spend counted by the budget guard: today's calls that actually reached the model.
    async spentToday(workspaceId: string) {
      const [row] = await db
        .select({ usd: sum(aiCalls.costUsd), calls: count() })
        .from(aiCalls)
        .where(
          and(
            eq(aiCalls.workspaceId, workspaceId),
            gte(aiCalls.createdAt, startOfUtcDay()),
            ne(aiCalls.outcome, "budget_blocked"),
          ),
        );
      return { usd: Number(row?.usd ?? 0), calls: row?.calls ?? 0 };
    },

    async list(workspaceId: string, filters: { kind?: AiCallKind; limit: number }) {
      const conditions = [eq(aiCalls.workspaceId, workspaceId)];
      if (filters.kind) conditions.push(eq(aiCalls.kind, filters.kind));
      return db
        .select()
        .from(aiCalls)
        .where(and(...conditions))
        .orderBy(desc(aiCalls.createdAt))
        .limit(filters.limit);
    },

    async summary(workspaceId: string) {
      return db
        .select({
          kind: aiCalls.kind,
          model: aiCalls.model,
          outcome: aiCalls.outcome,
          calls: count(),
          inputTokens: sql<number>`coalesce(sum(${aiCalls.inputTokens}), 0)::int`,
          outputTokens: sql<number>`coalesce(sum(${aiCalls.outputTokens}), 0)::int`,
          costUsd: sql<number>`coalesce(sum(${aiCalls.costUsd}), 0)::float8`,
          billedUsd: sql<number>`coalesce(sum(${aiCalls.billedUsd}), 0)::float8`,
        })
        .from(aiCalls)
        .where(eq(aiCalls.workspaceId, workspaceId))
        .groupBy(aiCalls.kind, aiCalls.model, aiCalls.outcome)
        .orderBy(aiCalls.kind, aiCalls.model, aiCalls.outcome);
    },
  };
}

export type AiCallsRepo = ReturnType<typeof aiCallsRepo>;
