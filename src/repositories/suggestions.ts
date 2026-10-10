import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { images, posts, reviewActions, suggestions } from "../db/schema.js";
import type { GuardConfig } from "../config/guard.js";
import type { Reason, Verdict } from "../domain/guard.js";

export type ReviewStatus = (typeof suggestions.reviewStatus.enumValues)[number];
export type ReviewActionKind = (typeof reviewActions.action.enumValues)[number];

export interface SuggestionInput {
  workspaceId: string;
  postId: string;
  imageId: string;
  rank: number;
  similarity: number;
  verdict: Verdict;
  reasons: Reason[];
  guardVersion: string;
  guardConfig: GuardConfig;
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
            guardConfig: sql`excluded.guard_config`,
          },
        })
        .returning({ id: suggestions.id, imageId: suggestions.imageId, reviewStatus: suggestions.reviewStatus });
    },

    // Everything needed to explain one decision: the pairing, the guard's reasons and thresholds,
    // the image's tags and the human review history.
    async findDetailed(workspaceId: string, suggestionId: string) {
      const [row] = await db
        .select({
          suggestion: suggestions,
          post: { id: posts.id, slug: posts.slug, title: posts.title, subject: posts.subject, subjectLabel: posts.subjectLabel, category: posts.category },
          image: {
            id: images.id,
            filePath: images.filePath,
            status: images.status,
            subject: images.subject,
            subjectLabel: images.subjectLabel,
            category: images.category,
            caption: images.caption,
            confidence: images.confidence,
            flagReason: images.flagReason,
          },
        })
        .from(suggestions)
        .innerJoin(posts, eq(posts.id, suggestions.postId))
        .innerJoin(images, eq(images.id, suggestions.imageId))
        .where(and(eq(suggestions.id, suggestionId), eq(suggestions.workspaceId, workspaceId)));
      if (!row) return null;
      const history = await db
        .select({ action: reviewActions.action, note: reviewActions.note, createdAt: reviewActions.createdAt })
        .from(reviewActions)
        .where(eq(reviewActions.suggestionId, suggestionId))
        .orderBy(asc(reviewActions.createdAt));
      return { ...row, history };
    },

    async listForReview(workspaceId: string, filters: { status: ReviewStatus; verdict?: Verdict; limit: number }) {
      const conditions = [eq(suggestions.workspaceId, workspaceId), eq(suggestions.reviewStatus, filters.status)];
      if (filters.verdict) conditions.push(eq(suggestions.verdict, filters.verdict));
      return db
        .select({
          id: suggestions.id,
          rank: suggestions.rank,
          similarity: suggestions.similarity,
          verdict: suggestions.verdict,
          reviewStatus: suggestions.reviewStatus,
          reasons: suggestions.reasons,
          updatedAt: suggestions.updatedAt,
          postId: posts.id,
          postTitle: posts.title,
          imageId: images.id,
          imageFile: images.filePath,
          imageCaption: images.caption,
        })
        .from(suggestions)
        .innerJoin(posts, eq(posts.id, suggestions.postId))
        .innerJoin(images, eq(images.id, suggestions.imageId))
        .where(and(...conditions))
        .orderBy(asc(posts.title), asc(suggestions.rank))
        .limit(filters.limit);
    },

    async findActionByKey(workspaceId: string, idempotencyKey: string) {
      const [row] = await db
        .select()
        .from(reviewActions)
        .where(and(eq(reviewActions.workspaceId, workspaceId), eq(reviewActions.idempotencyKey, idempotencyKey)));
      return row ?? null;
    },

    // Applies a review decision once. Runs in a transaction with the suggestion row locked, so two
    // concurrent requests cannot both decide it; the unique key makes a replayed request a no-op.
    async decide(
      input: { workspaceId: string; suggestionId: string; action: ReviewActionKind; note?: string; idempotencyKey: string },
      buildResponse: (s: typeof suggestions.$inferSelect, newStatus: ReviewStatus) => object,
      check: (s: typeof suggestions.$inferSelect) => void,
    ) {
      return db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(suggestions)
          .where(and(eq(suggestions.id, input.suggestionId), eq(suggestions.workspaceId, input.workspaceId)))
          .for("update");
        if (!current) return null;
        check(current);

        const newStatus: ReviewStatus = input.action === "approve" ? "approved" : "rejected";
        await tx.update(suggestions).set({ reviewStatus: newStatus }).where(eq(suggestions.id, current.id));
        const response = buildResponse(current, newStatus);
        await tx.insert(reviewActions).values({
          workspaceId: input.workspaceId,
          suggestionId: current.id,
          action: input.action,
          note: input.note,
          idempotencyKey: input.idempotencyKey,
          response,
        });
        return response;
      });
    },

    async recentActions(workspaceId: string, limit: number) {
      return db
        .select()
        .from(reviewActions)
        .where(eq(reviewActions.workspaceId, workspaceId))
        .orderBy(desc(reviewActions.createdAt))
        .limit(limit);
    },
  };
}

export type SuggestionsRepo = ReturnType<typeof suggestionsRepo>;
