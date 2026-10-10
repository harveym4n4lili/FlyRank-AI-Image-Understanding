import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp, type AppDeps } from "../src/app.js";
import { hashApiKey } from "../src/http/auth.js";
import type { IngestionService } from "../src/services/ingestion.js";
import type { MatchingService } from "../src/services/matching.js";
import type { PostsService } from "../src/services/posts.js";
import type { QueryService } from "../src/services/queries.js";
import type { ReviewService } from "../src/services/review.js";

const KEY = "test-key";
const WORKSPACE = "11111111-1111-4111-8111-111111111111";

function makeApp(overrides: Partial<AppDeps> = {}) {
  const ingestion = {
    startBatch: vi.fn(async () => ({ jobId: "b", total: 2, enqueued: 2, skipped: 0 })),
    batchProgress: vi.fn(),
  } as unknown as IngestionService;
  const queries = {
    listImages: vi.fn(async () => []),
    getImage: vi.fn(),
    listCosts: vi.fn(async () => []),
    costSummary: vi.fn(async () => ({ totals: { calls: 0 } })),
  } as unknown as QueryService;
  const posts = {
    create: vi.fn(async (_ws: string, input: { slug: string }) => ({ post: { id: "p1", ...input }, created: input.slug !== "existing" })),
    get: vi.fn(),
    list: vi.fn(async () => []),
    enqueuePendingPosts: vi.fn(async () => ({ enqueued: 0 })),
    enqueueMissingImageEmbeddings: vi.fn(async () => ({ enqueued: 50 })),
  } as unknown as PostsService;
  const matching = {
    matchForPost: vi.fn(async () => ({ result: "MATCH" })),
    checkCandidate: vi.fn(async () => ({ verdict: "REJECTED" })),
  } as unknown as MatchingService;
  const review = {
    list: vi.fn(async () => []),
    explain: vi.fn(async () => ({ id: "s1" })),
    decide: vi.fn(async (input: { action: string }) => ({ id: "s1", reviewStatus: input.action === "approve" ? "approved" : "rejected", replayed: false })),
  } as unknown as ReviewService;
  const deps: AppDeps = {
    checkDb: async () => true,
    resolveWorkspace: async (hash) => (hash === hashApiKey(KEY) ? WORKSPACE : null),
    ingestion,
    queries,
    posts,
    matching,
    review,
    ...overrides,
  };
  return { app: createApp(deps), deps, ingestion, queries, posts, matching, review };
}

describe("health", () => {
  it("reports ok when the database is reachable, without an API key", async () => {
    const res = await request(makeApp().app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", db: true });
  });

  it("reports 503 when the database check fails", async () => {
    const { app } = makeApp({ checkDb: async () => { throw new Error("down"); } });
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.db).toBe(false);
  });
});

describe("auth", () => {
  it("rejects requests without an API key with 401", async () => {
    const res = await request(makeApp().app).get("/images");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects an unknown API key with 401", async () => {
    const res = await request(makeApp().app).get("/images").set("X-Api-Key", "wrong");
    expect(res.status).toBe(401);
  });

  it("scopes calls to the key's workspace", async () => {
    const { app, queries } = makeApp();
    await request(app).get("/images?status=flagged").set("X-Api-Key", KEY).expect(200);
    expect(queries.listImages).toHaveBeenCalledWith(WORKSPACE, { status: "flagged", limit: 100, offset: 0 });
  });
});

describe("validation at the boundary (4xx, never 500)", () => {
  const cases: [string, () => request.Test][] = [
    ["unknown status filter", () => request(makeApp().app).get("/images?status=bogus").set("X-Api-Key", KEY)],
    ["unknown label filter", () => request(makeApp().app).get("/images?label=cat").set("X-Api-Key", KEY)],
    ["non-uuid image id", () => request(makeApp().app).get("/images/123").set("X-Api-Key", KEY)],
    ["non-uuid job id", () => request(makeApp().app).get("/jobs/abc").set("X-Api-Key", KEY)],
    ["limit out of range", () => request(makeApp().app).get("/costs?limit=9999").set("X-Api-Key", KEY)],
    ["path traversal in dir", () => request(makeApp().app).post("/jobs/ingest-images").set("X-Api-Key", KEY).send({ dir: "../etc" })],
    ["unexpected body field", () => request(makeApp().app).post("/jobs/ingest-images").set("X-Api-Key", KEY).send({ dir: "images", force: true })],
    ["post without body", () => request(makeApp().app).post("/posts").set("X-Api-Key", KEY).send({ slug: "red-fox", title: "Red foxes" })],
    ["post slug with spaces", () => request(makeApp().app).post("/posts").set("X-Api-Key", KEY).send({ slug: "Red Fox", title: "Red foxes", body: "x".repeat(30) })],
    ["match limit too high", () => request(makeApp().app).get(`/posts/${WORKSPACE}/images?limit=500`).set("X-Api-Key", KEY)],
    ["check with non-uuid image", () => request(makeApp().app).post(`/posts/${WORKSPACE}/images/wolf/check`).set("X-Api-Key", KEY)],
  ];

  it.each(cases)("%s → 400", async (_name, send) => {
    const res = await send();
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await request(makeApp().app)
      .post("/jobs/ingest-images")
      .set("X-Api-Key", KEY)
      .set("Content-Type", "application/json")
      .send("{bad json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const res = await request(makeApp().app).get("/nope").set("X-Api-Key", KEY);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("POST /jobs/ingest-images", () => {
  it("accepts the batch with 202 and defaults dir to images", async () => {
    const { app, ingestion } = makeApp();
    const res = await request(app).post("/jobs/ingest-images").set("X-Api-Key", KEY).send({});
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe("b");
    expect(ingestion.startBatch).toHaveBeenCalledWith(WORKSPACE, "images");
  });
});

describe("posts & matching routes", () => {
  const body = { slug: "red-fox-behaviour", title: "The behaviour of red foxes", body: "Red foxes are clever and adaptable hunters." };

  it("creates a post with 201, and returns 200 for an existing slug", async () => {
    const { app } = makeApp();
    await request(app).post("/posts").set("X-Api-Key", KEY).send(body).expect(201);
    await request(app).post("/posts").set("X-Api-Key", KEY).send({ ...body, slug: "existing" }).expect(200);
  });

  it("passes the workspace, post id and limit to matching", async () => {
    const { app, matching } = makeApp();
    await request(app).get(`/posts/${WORKSPACE}/images?limit=3`).set("X-Api-Key", KEY).expect(200);
    expect(matching.matchForPost).toHaveBeenCalledWith(WORKSPACE, WORKSPACE, 3);
  });

  it("queues missing image embeddings with 202", async () => {
    const res = await request(makeApp().app).post("/jobs/embed-images").set("X-Api-Key", KEY).send({});
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ enqueued: 50 });
  });
});

describe("review routes", () => {
  const SUGGESTION = "22222222-2222-4222-8222-222222222222";

  it("serves the review page without an API key (it is only a shell)", async () => {
    const res = await request(makeApp().app).get("/review.html");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Suggestion review");
  });

  it("still protects the review data with the API key", async () => {
    await request(makeApp().app).get("/review").expect(401);
  });

  it("requires an Idempotency-Key to approve", async () => {
    const res = await request(makeApp().app).post(`/suggestions/${SUGGESTION}/approve`).set("X-Api-Key", KEY).send({});
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("Idempotency-Key");
  });

  it("rejects a malformed Idempotency-Key", async () => {
    await request(makeApp().app)
      .post(`/suggestions/${SUGGESTION}/approve`)
      .set("X-Api-Key", KEY)
      .set("Idempotency-Key", "x")
      .send({})
      .expect(400);
  });

  it("passes the decision through with the key and note", async () => {
    const { app, review } = makeApp();
    const res = await request(app)
      .post(`/suggestions/${SUGGESTION}/reject`)
      .set("X-Api-Key", KEY)
      .set("Idempotency-Key", "review-key-123")
      .send({ note: "wrong season" });
    expect(res.status).toBe(200);
    expect(review.decide).toHaveBeenCalledWith({
      workspaceId: WORKSPACE,
      suggestionId: SUGGESTION,
      action: "reject",
      note: "wrong season",
      idempotencyKey: "review-key-123",
    });
  });

  it("validates review filters", async () => {
    await request(makeApp().app).get("/review?status=maybe").set("X-Api-Key", KEY).expect(400);
  });
});
