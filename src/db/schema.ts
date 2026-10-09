// Drizzle table definitions (see docs/SPEC.md#data-model). Every change ships as a
// generated migration in drizzle/ — run `npm run db:generate` after editing this file.
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`);

export const imageStatus = pgEnum("image_status", ["pending", "processing", "tagged", "flagged", "failed"]);
export const aiCallKind = pgEnum("ai_call_kind", ["vision", "embed", "post_extract"]);
export const aiCallOutcome = pgEnum("ai_call_outcome", ["ok", "invalid_output", "error", "budget_blocked"]);
export const postStatus = pgEnum("post_status", ["pending", "embedded", "failed"]);
export const verdict = pgEnum("verdict", ["ACCEPTED", "REJECTED"]);
export const reviewStatus = pgEnum("review_status", ["pending", "approved", "rejected"]);

export const EMBEDDING_DIMENSIONS = 768;

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  apiKeyHash: text("api_key_hash").notNull().unique(),
  createdAt: createdAt(),
});

// One row per POST /jobs/ingest-images call; progress is derived from its images' statuses.
export const ingestBatches = pgTable(
  "ingest_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    dir: text("dir").notNull(),
    total: integer("total").notNull(),
    enqueued: integer("enqueued").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ingest_batches_workspace_idx").on(t.workspaceId, t.createdAt)],
);

export const images = pgTable(
  "images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    batchId: uuid("batch_id").references(() => ingestBatches.id),
    filePath: text("file_path").notNull(),
    contentHash: text("content_hash").notNull(),
    status: imageStatus("status").notNull().default("pending"),
    flagReason: text("flag_reason"),
    subject: text("subject"),
    subjectLabel: text("subject_label"),
    category: text("category"),
    caption: text("caption"),
    confidence: real("confidence"),
    rawResponse: jsonb("raw_response"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Same bytes in the same workspace = same image: makes ingestion idempotent.
    uniqueIndex("images_workspace_hash_uq").on(t.workspaceId, t.contentHash),
    index("images_workspace_status_idx").on(t.workspaceId, t.status),
    index("images_workspace_label_idx").on(t.workspaceId, t.subjectLabel),
    index("images_batch_idx").on(t.batchId),
  ],
);

export const imageTags = pgTable(
  "image_tags",
  {
    imageId: uuid("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => [primaryKey({ columns: [t.imageId, t.tag] }), index("image_tags_tag_idx").on(t.tag)],
);

// Cost log: one row per AI call, including failed, invalid and budget-blocked ones.
export const aiCalls = pgTable(
  "ai_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    kind: aiCallKind("kind").notNull(),
    model: text("model").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    jobId: text("job_id"),
    attempt: integer("attempt").notNull().default(1),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 8, mode: "number" }).notNull().default(0),
    billedUsd: numeric("billed_usd", { precision: 12, scale: 8, mode: "number" }).notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    outcome: aiCallOutcome("outcome").notNull(),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("ai_calls_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("ai_calls_subject_idx").on(t.subjectType, t.subjectId),
    index("ai_calls_job_idx").on(t.jobId),
  ],
);

// Embedding vectors (768-dim, L2-normalised) with an HNSW cosine index; see docs/SPEC.md#data-model.
export const imageEmbeddings = pgTable(
  "image_embeddings",
  {
    imageId: uuid("image_id")
      .primaryKey()
      .references(() => images.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    inputText: text("input_text").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("image_embeddings_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops"))],
);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    subject: text("subject"),
    subjectLabel: text("subject_label"),
    category: text("category"),
    status: postStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Same slug in the same workspace = same post: makes POST /posts idempotent.
    uniqueIndex("posts_workspace_slug_uq").on(t.workspaceId, t.slug),
    index("posts_workspace_status_idx").on(t.workspaceId, t.status),
  ],
);

export const postEmbeddings = pgTable(
  "post_embeddings",
  {
    postId: uuid("post_id")
      .primaryKey()
      .references(() => posts.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    inputText: text("input_text").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("post_embeddings_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops"))],
);

// Every guard decision for a (post, image) pair, accepted or rejected, so any past decision can be explained.
export const suggestions = pgTable(
  "suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    imageId: uuid("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    similarity: real("similarity").notNull(),
    verdict: verdict("verdict").notNull(),
    reasons: jsonb("reasons").notNull(),
    guardVersion: text("guard_version").notNull(),
    reviewStatus: reviewStatus("review_status").notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("suggestions_post_image_uq").on(t.postId, t.imageId),
    index("suggestions_post_rank_idx").on(t.postId, t.rank),
    index("suggestions_workspace_review_idx").on(t.workspaceId, t.reviewStatus),
  ],
);
