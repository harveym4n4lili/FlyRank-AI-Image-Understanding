# Spec — Data Model & API

## Data model

PostgreSQL 16 + `pgvector`. Schema changes are made only as Drizzle migrations (`drizzle/`), never by
hand. Every domain table carries `workspace_id`, and every query is scoped by it, which keeps tenants isolated.

### Vision output schema

The model must return exactly this shape. It is validated with Zod before anything is stored.

```ts
const ImageTags = z.object({
  subject:       z.string().min(1).max(80),          // free text, e.g. "red fox"
  subject_label: z.enum(SUBJECT_LABELS),             // controlled vocab, e.g. "red_fox" | ... | "unknown"
  category:      z.enum(["animal", "landscape", "food", "people", "object", "other"]),
  attributes:    z.array(z.string().min(1).max(40)).min(1).max(10),
  caption:       z.string().min(10).max(300),
  confidence:    z.number().min(0).max(1),
}).strict();
```

`SUBJECT_LABELS` lives in `src/config/taxonomy.ts` (red_fox, arctic_fox, gray_wolf, dog, brown_bear,
black_bear, white_tailed_deer, red_deer, …, `unknown`). Why there are two subject fields:
[GUARD_AND_EVAL.md](GUARD_AND_EVAL.md#why-a-controlled-subject-label).

### Tables

| Table | Key columns | Indexes / constraints |
|---|---|---|
| `workspaces` | id, name, `api_key_hash` (sha256; the plain key is shown once at seed) | unique(api_key_hash) |
| `images` | workspace_id, file_path, `content_hash`, source_url/license/credit, `status` (`pending → processing → tagged \| flagged \| failed`), flag_reason, subject, subject_label, category, caption, confidence, raw_response jsonb, attempts | unique(workspace_id, content_hash) — **idempotent ingestion**; (workspace_id, status); (workspace_id, subject_label) |
| `image_tags` | image_id, tag (one row per attribute) | pk(image_id, tag); (tag) |
| `image_embeddings` / `post_embeddings` | image_id / post_id (pk), model, `input_text` (exactly what was embedded), `embedding vector(768)` | HNSW `vector_cosine_ops` |
| `posts` | workspace_id, `slug`, title, body, extracted subject/subject_label/category, status (`pending → embedded \| failed`) | unique(workspace_id, slug) — idempotent creation |
| `suggestions` | post_id, image_id, rank, similarity, `verdict` (ACCEPTED \| REJECTED), `reasons` jsonb `[{code, message, detail}]`, `guard_version`, `review_status` (pending \| approved \| rejected) | unique(post_id, image_id); (post_id, rank); (workspace_id, review_status) |
| `review_actions` | suggestion_id, action (approve \| reject), note, `idempotency_key` | unique(workspace_id, idempotency_key) — a retried request is recorded once |
| `ai_calls` | kind (vision \| embed \| post_extract), model, subject_type + subject_id (**cost attribution**), job_id, attempt, input/output tokens, `cost_usd` (notional, from `src/config/pricing.ts`), `billed_usd` (0 on the free tier), latency_ms, outcome (ok \| invalid_output \| error \| budget_blocked) | (workspace_id, created_at); (subject_type, subject_id); (job_id) |

Notes:
- With about 50 rows a sequential scan would be just as fast as HNSW, but the index is the production pattern and shows up in `EXPLAIN`.
- `guard_version` is a hash of the thresholds used, so an old decision stays explainable after the thresholds are tuned.
- **Every** AI call gets an `ai_calls` row, including failed and invalid ones, because those cost money too.
  Token counts come from `usageMetadata`, or are estimated as chars/4 when absent.

## API

Base URL `http://localhost:3000`. All endpoints except `/health` require `X-Api-Key`, which maps to a
workspace. Every param, query and body is validated with Zod. Bad input returns **400**
`{ error: { code, message, issues[] } }`. Unknown ids return **404**. A missing or invalid key returns **401**.
A 500 only happens for genuine bugs, and the error is logged without secrets.

| Method | Path | Notes |
|---|---|---|
| POST | `/jobs/ingest-images` | `{ dir? }` → **202** `{ jobId }`. One job per file; files already ingested (same content hash) are skipped |
| POST | `/jobs/embed-posts` | **202** `{ jobId }`. Embeds every post that is still `pending` |
| GET | `/jobs/:id` | `{ state, total, done, failed, flagged, progress }` |
| GET | `/images?status=&label=` | filters are validated against the enums |
| GET | `/images/:id` | tags, confidence, flag reason, attempts, cost total |
| POST | `/posts` | `{ slug, title, body }`. Idempotent on slug: **201**, or **200** if it already exists. Enqueues extraction and embedding |
| GET | `/posts/:id` | includes the extracted subject, label and category |
| GET | `/posts/:id/images?limit=5` | ranked candidates + guard verdicts (shape below). **409** if the post is not embedded yet |
| POST | `/posts/:id/images/:imageId/check` | runs the guard on one forced image (Probe 3). Creates no suggestion |
| GET | `/review?status=pending` | server-rendered HTML table; JSON with `Accept: application/json` |
| GET | `/suggestions/:id` | the full "why": reasons, thresholds (`guard_version`), image tags, similarity, review history |
| POST | `/suggestions/:id/approve` · `/reject` | `Idempotency-Key` header required, body `{ note? }`. Same key → original response; a different key on an already-decided suggestion → **409** |
| GET | `/costs?kind=&limit=` | raw `ai_calls` rows |
| GET | `/costs/summary` | totals by kind/model, notional vs billed, budget used / remaining |
| GET | `/health` | DB reachability (200 / 503) |

### Matching response

```json
{
  "post": { "id": "...", "title": "The behavior of red foxes", "subject_label": "red_fox" },
  "result": "MATCH",
  "suggestions": [
    { "imageId": "...", "rank": 1, "similarity": 0.87, "verdict": "ACCEPTED",
      "caption": "A red fox standing in a forest",
      "reasons": [{ "code": "SUBJECT_OK", "message": "Subject matches: red fox" }] }
  ],
  "rejected": [
    { "imageId": "...", "rank": 2, "similarity": 0.81, "verdict": "REJECTED",
      "reasons": [{ "code": "SUBJECT_MISMATCH", "message": "Subject mismatch: expected red fox, detected gray wolf" }] }
  ]
}
```

If nothing passes, it returns `"result": "NO_CONFIDENT_MATCH"`, `suggestions: []`, and a `reasons` array summarizing why the best candidates failed.
