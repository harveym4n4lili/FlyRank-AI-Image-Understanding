import type { Verdict } from "../domain/guard.js";
import { AppError } from "../lib/errors.js";
import type { ReviewActionKind, ReviewStatus, SuggestionsRepo } from "../repositories/suggestions.js";

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === PG_UNIQUE_VIOLATION || e?.cause?.code === PG_UNIQUE_VIOLATION;
}

// Human-in-the-loop review of guard suggestions.
export function reviewService(deps: { suggestions: SuggestionsRepo }) {
  return {
    list: (workspaceId: string, filters: { status: ReviewStatus; verdict?: Verdict; limit: number }) =>
      deps.suggestions.listForReview(workspaceId, filters),

    // The full "why" behind a suggestion.
    async explain(workspaceId: string, suggestionId: string) {
      const found = await deps.suggestions.findDetailed(workspaceId, suggestionId);
      if (!found) throw new AppError(404, "NOT_FOUND", "No such suggestion");
      const { suggestion: s, post, image, history } = found;
      return {
        id: s.id,
        verdict: s.verdict,
        reviewStatus: s.reviewStatus,
        why: {
          summary:
            s.verdict === "ACCEPTED"
              ? `Suggested because it passed every guard rule (similarity ${s.similarity.toFixed(2)}, rank ${s.rank}).`
              : `Refused by the guard: ${(s.reasons as { message: string }[]).map((r) => r.message).join("; ")}.`,
          reasons: s.reasons,
          similarity: s.similarity,
          rank: s.rank,
          thresholds: s.guardConfig,
          guardVersion: s.guardVersion,
        },
        post,
        image,
        history,
        decidedAt: s.updatedAt,
      };
    },

    // Approve/reject exactly once per Idempotency-Key:
    // - same key again → the original response, nothing new recorded
    // - same key for a different suggestion/action → 422
    // - a new key on an already-decided suggestion → 409
    async decide(input: {
      workspaceId: string;
      suggestionId: string;
      action: ReviewActionKind;
      note?: string;
      idempotencyKey: string;
    }) {
      const replay = async () => {
        const previous = await deps.suggestions.findActionByKey(input.workspaceId, input.idempotencyKey);
        if (!previous) return null;
        if (previous.suggestionId !== input.suggestionId || previous.action !== input.action) {
          throw new AppError(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different request");
        }
        return { ...(previous.response as object), replayed: true };
      };

      const earlier = await replay();
      if (earlier) return earlier;

      try {
        const response = await deps.suggestions.decide(
          input,
          (s, newStatus) => ({ id: s.id, action: input.action, reviewStatus: newStatus, note: input.note ?? null }),
          (s) => {
            if (s.reviewStatus !== "pending") {
              throw new AppError(409, "ALREADY_DECIDED", `Suggestion was already ${s.reviewStatus}`);
            }
            if (input.action === "approve" && s.verdict !== "ACCEPTED") {
              throw new AppError(409, "GUARD_REJECTED", "The guard rejected this pairing, so it cannot be approved");
            }
          },
        );
        if (!response) throw new AppError(404, "NOT_FOUND", "No such suggestion");
        return { ...response, replayed: false };
      } catch (err) {
        // Two identical requests raced: the loser replays the winner's stored response.
        if (isUniqueViolation(err)) {
          const winner = await replay();
          if (winner) return winner;
        }
        throw err;
      }
    },
  };
}

export type ReviewService = ReturnType<typeof reviewService>;
