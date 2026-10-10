import { describe, expect, it } from "vitest";
import type { SuggestionsRepo } from "../src/repositories/suggestions.js";
import { reviewService } from "../src/services/review.js";

type Suggestion = { id: string; workspaceId: string; verdict: "ACCEPTED" | "REJECTED"; reviewStatus: string };
type Action = { suggestionId: string; action: string; idempotencyKey: string; response: object };

// In-memory stand-in for the suggestions repository, enough to exercise the idempotency rules.
function fakeRepo(initial: Suggestion[]) {
  const suggestions = new Map(initial.map((s) => [s.id, { ...s }]));
  const actions: Action[] = [];
  const repo = {
    async findActionByKey(_ws: string, key: string) {
      return actions.find((a) => a.idempotencyKey === key) ?? null;
    },
    async decide(
      input: { suggestionId: string; action: "approve" | "reject"; idempotencyKey: string },
      build: (s: Suggestion, status: string) => object,
      check: (s: Suggestion) => void,
    ) {
      const s = suggestions.get(input.suggestionId);
      if (!s) return null;
      check(s);
      if (actions.some((a) => a.idempotencyKey === input.idempotencyKey)) throw Object.assign(new Error("dup"), { code: "23505" });
      const status = input.action === "approve" ? "approved" : "rejected";
      s.reviewStatus = status;
      const response = build(s, status);
      actions.push({ suggestionId: s.id, action: input.action, idempotencyKey: input.idempotencyKey, response });
      return response;
    },
  } as unknown as SuggestionsRepo;
  return { repo, actions, suggestions };
}

const base = { workspaceId: "ws", note: undefined };

describe("review decisions", () => {
  it("approves an accepted suggestion once", async () => {
    const { repo, actions } = fakeRepo([{ id: "s1", workspaceId: "ws", verdict: "ACCEPTED", reviewStatus: "pending" }]);
    const result = await reviewService({ suggestions: repo }).decide({ ...base, suggestionId: "s1", action: "approve", idempotencyKey: "k1" });
    expect(result).toMatchObject({ id: "s1", reviewStatus: "approved", replayed: false });
    expect(actions).toHaveLength(1);
  });

  it("replays the original response for the same Idempotency-Key, recording nothing new", async () => {
    const { repo, actions } = fakeRepo([{ id: "s1", workspaceId: "ws", verdict: "ACCEPTED", reviewStatus: "pending" }]);
    const svc = reviewService({ suggestions: repo });
    const first = await svc.decide({ ...base, suggestionId: "s1", action: "approve", idempotencyKey: "k1" });
    const second = await svc.decide({ ...base, suggestionId: "s1", action: "approve", idempotencyKey: "k1" });
    expect(second).toEqual({ ...first, replayed: true });
    expect(actions).toHaveLength(1);
  });

  it("returns 409 when a new key targets an already-decided suggestion", async () => {
    const { repo } = fakeRepo([{ id: "s1", workspaceId: "ws", verdict: "ACCEPTED", reviewStatus: "pending" }]);
    const svc = reviewService({ suggestions: repo });
    await svc.decide({ ...base, suggestionId: "s1", action: "approve", idempotencyKey: "k1" });
    await expect(svc.decide({ ...base, suggestionId: "s1", action: "reject", idempotencyKey: "k2" })).rejects.toMatchObject({
      status: 409,
      code: "ALREADY_DECIDED",
    });
  });

  it("returns 422 when a key is reused for a different request", async () => {
    const { repo } = fakeRepo([
      { id: "s1", workspaceId: "ws", verdict: "ACCEPTED", reviewStatus: "pending" },
      { id: "s2", workspaceId: "ws", verdict: "ACCEPTED", reviewStatus: "pending" },
    ]);
    const svc = reviewService({ suggestions: repo });
    await svc.decide({ ...base, suggestionId: "s1", action: "approve", idempotencyKey: "k1" });
    await expect(svc.decide({ ...base, suggestionId: "s2", action: "approve", idempotencyKey: "k1" })).rejects.toMatchObject({
      status: 422,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  it("refuses to approve a pairing the guard rejected, but allows rejecting it", async () => {
    const { repo } = fakeRepo([{ id: "s1", workspaceId: "ws", verdict: "REJECTED", reviewStatus: "pending" }]);
    const svc = reviewService({ suggestions: repo });
    await expect(svc.decide({ ...base, suggestionId: "s1", action: "approve", idempotencyKey: "k1" })).rejects.toMatchObject({
      status: 409,
      code: "GUARD_REJECTED",
    });
    await expect(svc.decide({ ...base, suggestionId: "s1", action: "reject", idempotencyKey: "k2" })).resolves.toMatchObject({
      reviewStatus: "rejected",
    });
  });

  it("returns 404 for an unknown suggestion", async () => {
    const { repo } = fakeRepo([]);
    await expect(
      reviewService({ suggestions: repo }).decide({ ...base, suggestionId: "nope", action: "reject", idempotencyKey: "k1" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
