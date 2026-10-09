# Decisions Log

Short records of choices and why they were made. Add new entries at the bottom; never rewrite old ones.
Mark an entry as superseded instead.

| # | Date | Decision | Why | Alternatives |
|---|---|---|---|---|
| 1 | 2026-10-09 | **Node 20 + Express** | My choice of track language | Python + FastAPI |
| 2 | 2026-10-09 | **TypeScript** *(default, open to change)* | Zod schemas infer types across layers; fewer shape bugs between vision output, DB and API | Plain JS |
| 3 | 2026-10-09 | **Gemini Flash (vision) + Gemini embeddings** | Free tier with no card, native JSON-schema structured output, better tagging than small local models | Ollama llava + all-minilm (offline, weaker) |
| 4 | 2026-10-09 | **Postgres + pgvector, 768-dim, HNSW cosine** | Real vector index, one database for everything; 768 dims keeps vectors small and inside pgvector's index limits. Truncated Gemini vectors must be L2-normalized | Float arrays + cosine in app |
| 5 | 2026-10-09 | **pg-boss** for jobs *(default, open to change)* | Queue lives in the same Postgres, with built-in retries/backoff/singleton keys and no extra container | BullMQ + Redis, hand-rolled jobs table |
| 6 | 2026-10-09 | **Drizzle ORM + drizzle-kit** *(default, open to change)* | TS-first, SQL-shaped, migrations as committed files, supports the pgvector column type | Prisma (pgvector via raw SQL), raw `pg` + node-pg-migrate |
| 7 | 2026-10-09 | **Wild-animal corpus** (fox, wolf, dog, bear, deer) | Mirrors the brief's probes; contains a natural near-miss (fox/wolf, husky/wolf) | Mixed themes |
| 8 | 2026-10-09 | **Controlled `subject_label` alongside free-text `subject`** | Embeddings handle synonyms for ranking; the guard needs a crisp label to refuse fox ≠ wolf (see GUARD.md) | Guard on embedding similarity of subjects only |
| 9 | 2026-10-09 | **Notional cost + billed cost logged separately** | Free tier bills $0, but the habit and the budget guard need a realistic number; price table in config | Log tokens only |
| 10 | 2026-10-09 | **Same embedding task type for both sides** (`SEMANTIC_SIMILARITY`) as the starting point | Recommended in the brief; RETRIEVAL_DOCUMENT/QUERY to be compared during eval if precision is weak | Asymmetric retrieval task types |
| 11 | 2026-10-09 | **Model ids in env**, not code (`GEMINI_VISION_MODEL`, `GEMINI_EMBED_MODEL`) | Free-tier model names change; pick the current Flash model from the AI Studio free-tier page at build time | Hard-coded ids |

## Open questions
- Exact Gemini model ids and current free-tier rate limits: check at the start of Phase 2 and record them here.
- Should images be committed or only downloaded by script? Decide once the resized corpus size is known (target < 5 MB).
