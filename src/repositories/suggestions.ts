import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { suggestions } from "../db/schema.js";
import type { Reason, Verdict } from "../domain/guard.js";

export interface SuggestionInput {
  workspaceId: string;
  postId: string;
  imageId: string;
  rank: number;
  similarity: number;
  verdict: Verdict;
  reasons: Reason[];
  guardVersion: string;
}

export function suggestionsRepo(db: Db) {
  return {
    // Records the latest guard decision per (post, image). A human review decision is kept as-is.
    async upsertMany(rows: SuggestionInput[]) {
      if (rows.length === 0) return [];
      return db
        .insert(suggestions)
        .values(rows)
        .onConflictDoUpdate({
          target: [suggestions.postId, suggestions.imageId],
          set: {
            rank: sql`excluded.rank`,
            similarity: sql`excluded.similarity`,
            verdict: sql`excluded.verdict`,
            reasons: sql`excluded.reasons`,
            guardVersion: sql`excluded.guard_version`,
          },
        })
        .returning({ id: suggestions.id, imageId: suggestions.imageId, reviewStatus: suggestions.reviewStatus });
    },
  };
}

export type SuggestionsRepo = ReturnType<typeof suggestionsRepo>;
