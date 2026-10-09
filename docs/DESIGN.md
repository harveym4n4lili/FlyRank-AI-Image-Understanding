# Design — AI Image Understanding & Content Matching Engine

> Phase 1 gate document. One page: problem, data model, API surface, layer sketch, non-goal.
> Detail lives in the linked docs.

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
   threshold, image confidence). The guard returns `ACCEPTED`, `REJECTED` + reasons, or
   `NO_CONFIDENT_MATCH` + reasons. See [GUARD.md](GUARD.md).
5. **Review** — accepted suggestions go to a human who approves or rejects them. Every decision can
   be inspected ("why was this picked / refused?").

## Data model (summary)

`workspaces` · `images` · `image_tags` · `image_embeddings` · `posts` · `post_embeddings` ·
`suggestions` · `review_actions` · `ai_calls` (cost log). pg-boss keeps its own job tables.
Full schema and indexes: [DATA_MODEL.md](DATA_MODEL.md).

## API surface (summary)

| Area | Endpoints |
|---|---|
| Jobs | `POST /jobs/ingest-images`, `POST /jobs/embed-posts`, `GET /jobs/:id` |
| Images | `GET /images`, `GET /images/:id` |
| Posts | `POST /posts`, `GET /posts/:id` |
| Matching | `GET /posts/:id/images`, `POST /posts/:id/images/:imageId/check` |
| Review | `GET /review`, `GET /suggestions/:id`, `POST /suggestions/:id/approve`, `POST /suggestions/:id/reject` |
| Ops | `GET /costs`, `GET /costs/summary`, `GET /health` |

Full contract: [API.md](API.md).

## Layer sketch

```
HTTP      routes/       Express routers · Zod validation of params/body/query · error → 4xx mapping
            │
Logic     services/     ingestion · embedding · matching · guard (pure) · review · eval
            │
Data      repositories/ Drizzle queries          providers/  Gemini client (retry, rate limit,
          db/           schema + migrations                  cost logging, budget guard)
            │
Async     worker/       pg-boss handlers: ingest-image, embed-image, embed-post
```

`api` and `worker` are two entry points sharing the same services. The guard is a pure function with
no I/O, so it can be unit-tested in isolation.

## Stack

Node 20 · TypeScript · Express · Zod · Drizzle ORM + drizzle-kit migrations · PostgreSQL 16 + pgvector
· pg-boss · Gemini Flash (vision) + Gemini embeddings · Docker Compose. Rationale: [DECISIONS.md](DECISIONS.md).

## Explicit non-goal

**No frontend application.** Review happens through validated JSON endpoints plus a server-rendered
HTML table at `GET /review`. Also out of scope for the core: comparing models, image generation,
and user accounts beyond a per-workspace API key.

## Success = the six acceptance probes pass

Tagging flags at least one low-confidence image · the fox ranks first · the wolf is refused with a
category/subject mismatch · an unmatched post returns "no confident match" · the eval script's
top-1 precision equals the number in the README · every AI call has a cost row.
See [ROADMAP.md](ROADMAP.md) for the mapping of probes to checklist items.
