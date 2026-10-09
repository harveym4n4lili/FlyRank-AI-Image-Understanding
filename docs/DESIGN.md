# Design — AI Image Understanding & Content Matching Engine

> Phase 1 gate document: problem, data model, API surface, layer sketch, non-goal.
> Other docs: [SPEC.md](SPEC.md) (tables + endpoints) · [GUARD_AND_EVAL.md](GUARD_AND_EVAL.md)
> (mismatch guard, corpus, eval) · [ROADMAP.md](ROADMAP.md) (phases, checklist, probes).

## Problem

Blog posts need the right image. Filenames and keyword search fail because they don't understand
what an image *shows*: a post about red foxes must surface the red-fox photo, a look-alike wolf must
be refused, and a generic dog must rank low. When no image is good enough, the system must say
**"no confident match"** with reasons instead of guessing.

The product is a **trustworthy decision system**, not a search engine: good suggestions when
confident, safe rejection when not.

## Approach

1. **Understand images** — a batch job sends each image to Gemini Flash and gets back structured
   tags (`subject`, `subject_label`, `category`, `attributes`, `caption`, `confidence`). Every response
   is validated with Zod. Invalid responses are retried and then marked failed; low-confidence ones are flagged.
2. **Embed both sides** — the image description text and the post text are embedded with Gemini
   embeddings (768-dim, normalized) and stored in Postgres with pgvector.
3. **Rank** — for a post, rank tagged images by cosine similarity.
4. **Guard** — every candidate passes the mismatch guard (subject label, category, similarity
   threshold, image confidence). It returns `ACCEPTED`, `REJECTED` + reasons, or `NO_CONFIDENT_MATCH` + reasons.
5. **Review** — accepted suggestions go to a human who approves or rejects them. Every decision can
   be inspected ("why was this picked / refused?").

## Data model (summary)

`workspaces` · `images` · `image_tags` · `image_embeddings` · `posts` · `post_embeddings` ·
`suggestions` · `review_actions` · `ai_calls` (cost log). pg-boss keeps its own job tables.
Columns and indexes: [SPEC.md](SPEC.md#data-model).

## API surface (summary)

| Area | Endpoints |
|---|---|
| Jobs | `POST /jobs/ingest-images`, `POST /jobs/embed-posts`, `GET /jobs/:id` |
| Images | `GET /images`, `GET /images/:id` |
| Posts | `POST /posts`, `GET /posts/:id` |
| Matching | `GET /posts/:id/images`, `POST /posts/:id/images/:imageId/check` |
| Review | `GET /review`, `GET /suggestions/:id`, `POST /suggestions/:id/approve`, `POST /suggestions/:id/reject` |
| Ops | `GET /costs`, `GET /costs/summary`, `GET /health` |

Full contract: [SPEC.md](SPEC.md#api).

## Layer sketch

```
HTTP      src/routes/, src/http/   Express routers · Zod validation · error → 4xx mapping
            │
Logic     src/services/            ingestion · embedding · matching · guard (pure) · review · eval
            │
Data      src/repositories/        Drizzle queries     src/providers/  Gemini client (retry, rate limit,
          src/db/                  schema + migrations                 cost logging, budget guard)
            │
Async     src/worker/              pg-boss handlers: ingest-image, embed-image, embed-post
```

`api` and `worker` are two entry points sharing the same services. The guard is a pure function with
no I/O, so it can be unit-tested in isolation.

## Explicit non-goal

**No frontend application.** Review happens through validated JSON endpoints plus a server-rendered
HTML table at `GET /review`. Also out of scope for the core: comparing models, image generation,
and user accounts beyond a per-workspace API key.

## Success = the six acceptance probes pass

Tagging flags at least one low-confidence image · the fox ranks first · the wolf is refused with a
subject mismatch · an unmatched post returns "no confident match" · the eval script's
top-1 precision equals the number in the README · every AI call has a cost row.

## Decisions log

Add new entries at the bottom; never rewrite old ones. Mark an entry as superseded instead.

| # | Date | Decision | Why | Alternatives |
|---|---|---|---|---|
| 1 | 2026-10-09 | **Node 24 + Express 5** | Track language; Node 24 is the current LTS | Python + FastAPI |
| 2 | 2026-10-09 | **TypeScript** | Zod schemas infer types across layers; fewer shape bugs between vision output, DB and API | Plain JS |
| 3 | 2026-10-09 | **Gemini Flash (vision) + Gemini embeddings** | Free tier with no card, native JSON-schema structured output, better tagging than small local models | Ollama llava + all-minilm |
| 4 | 2026-10-09 | **Postgres + pgvector, 768-dim, HNSW cosine** | Real vector index, one database for everything; truncated Gemini vectors must be L2-normalized | Float arrays + cosine in app |
| 5 | 2026-10-09 | **pg-boss** for jobs | Queue lives in the same Postgres, with retries, backoff and singleton keys and no extra container | BullMQ + Redis, hand-rolled |
| 6 | 2026-10-09 | **Drizzle ORM + drizzle-kit** | TS-first, SQL-shaped, migrations as committed files, supports the pgvector column type | Prisma, raw `pg` |
| 7 | 2026-10-09 | **Wild-animal corpus** (fox, wolf, dog, bear, deer) | Mirrors the brief's probes; contains natural near-misses (fox/wolf, husky/wolf) | Mixed themes |
| 8 | 2026-10-09 | **Controlled `subject_label` + free-text `subject`** | Embeddings handle synonyms for ranking; the guard needs a crisp label to refuse fox ≠ wolf | Guard on embedding similarity only |
| 9 | 2026-10-09 | **Notional + billed cost logged separately** | Free tier bills $0, but the budget guard needs a realistic number | Log tokens only |
| 10 | 2026-10-09 | **`SEMANTIC_SIMILARITY` task type on both sides** to start | Recommended by the brief; compare against RETRIEVAL_DOCUMENT/QUERY in eval if precision is weak | Asymmetric task types |
| 11 | 2026-10-09 | **Model ids in env** (`GEMINI_VISION_MODEL`, `GEMINI_EMBED_MODEL`) | Free-tier model names change; pick the current ones from AI Studio at build time | Hard-coded ids |

**Open questions:** exact Gemini model ids and free-tier rate limits (check at the start of Phase 2) ·
whether to commit images or only download them by script (decide once the resized corpus size is known; target < 5 MB).
