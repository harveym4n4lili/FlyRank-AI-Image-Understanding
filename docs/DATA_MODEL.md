# Data Model

PostgreSQL 16 + `pgvector`. Schema changes are made only as Drizzle migrations (`drizzle/`), never by
hand. Every domain table carries `workspace_id`, and every query is scoped by it, which keeps tenants isolated.

## Image metadata schema (vision output)

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
black_bear, white_tailed_deer, red_deer, ..., `unknown`). The free-text `subject` is kept for humans.
The guard compares `subject_label`. Why there are two fields: [GUARD.md](GUARD.md#why-a-controlled-subject-label).

## Tables

### `workspaces`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text | |
| api_key_hash | text unique | sha256 of the key; the plain key is shown once, at seed time |
| created_at | timestamptz | |

### `images`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| workspace_id | uuid fk | |
| file_path | text | relative to `data/images/` |
| content_hash | text | sha256 of the bytes, used for **idempotent ingestion** |
| source_url, license, credit | text | Unsplash/Pexels attribution |
| status | enum | `pending` → `processing` → `tagged` \| `flagged` \| `failed` |
| flag_reason | text null | e.g. `low_confidence (0.42 < 0.70)`, `subject_unknown` |
| subject, subject_label, category, caption | text | from validated vision output |
| confidence | real | |
| raw_response | jsonb | last model output, kept for debugging |
| attempts | int | |
| created_at, updated_at | timestamptz | |

Indexes: `unique(workspace_id, content_hash)`, `(workspace_id, status)`, `(workspace_id, subject_label)`.

### `image_tags`
One row per attribute, so the data is queryable and normalized.
`image_id fk · tag text` with indexes `pk(image_id, tag)` and `(tag)`.

### `image_embeddings` / `post_embeddings`
| column | type | notes |
|---|---|---|
| image_id / post_id | uuid pk/fk | one current vector per item |
| model | text | embedding model id |
| input_text | text | exactly what was embedded |
| embedding | vector(768) | L2-normalized |
| created_at | timestamptz | |

Index: HNSW `embedding vector_cosine_ops`. At about 50 rows a sequential scan would be just as fast, but the index is
the production pattern and shows up in `EXPLAIN`.

### `posts`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| workspace_id | uuid fk | |
| slug | text | `unique(workspace_id, slug)`, which makes creation idempotent |
| title, body | text | |
| subject, subject_label, category | text null | extracted by Gemini (text-only call, same Zod pattern) |
| status | enum | `pending` → `embedded` \| `failed` |
| created_at | timestamptz | |

### `suggestions`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| workspace_id, post_id, image_id | uuid fk | `unique(post_id, image_id)` |
| rank | int | |
| similarity | real | cosine |
| verdict | enum | `ACCEPTED` \| `REJECTED` |
| reasons | jsonb | `[{code, message, detail}]`, the human-readable explanation |
| guard_version | text | thresholds snapshot, so old decisions stay explainable |
| review_status | enum | `pending` \| `approved` \| `rejected` |
| created_at, updated_at | timestamptz | |

Indexes: `(post_id, rank)`, `(workspace_id, review_status)`.

### `review_actions`
An audit trail for approve/reject.
`id · suggestion_id fk · action (approve|reject) · note · idempotency_key · created_at`
Index: `unique(workspace_id, idempotency_key)`. A retried request returns the original result and does
not record a second action.

### `ai_calls` (cost log)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| workspace_id | uuid | |
| kind | enum | `vision` \| `embed` \| `post_extract` |
| model | text | |
| subject_type, subject_id | text, uuid | what the call was for (image/post), which **attributes the cost** |
| job_id | text null | pg-boss job id |
| attempt | int | |
| input_tokens, output_tokens | int | from `usageMetadata`; estimated (chars/4) if absent |
| cost_usd | numeric(10,6) | notional, from the price table in `src/config/pricing.ts` |
| billed_usd | numeric(10,6) | 0 on the free tier, logged separately so it is honest |
| latency_ms | int | |
| outcome | enum | `ok` \| `invalid_output` \| `error` \| `budget_blocked` |
| created_at | timestamptz | |

Indexes: `(workspace_id, created_at)`, `(subject_type, subject_id)`, `(job_id)`.

**Every** call gets a row, including failed and invalid ones, because those cost money too.
