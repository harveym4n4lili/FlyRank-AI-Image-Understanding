# Roadmap

Self-paced. Do the phases in order, and don't start the next phase until the current gate passes. Commit at least once per session.

## Phase 0 · Repo setup (≈1 h)
- [x] Public repo, MIT license
- [x] `.gitignore` (node_modules, .env, dist) **before** the first commit; add `.env.example`
- [x] Skeleton: `docker-compose.yml` (postgres+pgvector, api, worker), TS config, lint, vitest
- [x] Stub `README.md`, `EVIDENCE.md`, `BUILDLOG.md`, `capstone.yaml`

## Phase 1 · Design (≈4–6 h)
- [x] [DESIGN.md](DESIGN.md), [SPEC.md](SPEC.md), [GUARD_AND_EVAL.md](GUARD_AND_EVAL.md) reviewed
- [x] Taxonomy list finalized (`src/config/taxonomy.ts`)
- [x] 50-image manifest hand-picked from Pexels (`data/manifest.json`); download script written
- [x] Images downloaded with `npm run corpus:download` and checked by eye (incl. the 4 `SPECIES UNVERIFIED` deer)
- **GATE:** design docs committed

## Phase 2 · Image understanding pipeline (≈10–14 h)
- [ ] Drizzle schema + first migration; seed script (workspace + API key)
- [ ] Gemini provider: structured output + Zod `safeParse`; retry on invalid output (max 3, exponential backoff)
- [ ] Every call writes to `ai_calls`; budget guard checked before each call
- [ ] pg-boss `ingest-image` job, idempotent on content hash; progress via `/jobs/:id`
- [ ] A final failure triggers an alert (error log + optional `ALERT_WEBHOOK_URL`)
- [ ] Flagging rule (`T_CONF`, unknown label)
- **GATE:** all 50 images are tagged or flagged, `/costs/summary` shows every call

## Phase 3 · Matching engine (≈12–16 h)
- [ ] Post creation + subject extraction + embedding jobs
- [ ] Image embeddings (caption + subject + attributes)
- [ ] pgvector cosine ranking
- [ ] Guard as a pure module, with unit tests first (fox ✓, wolf ✗, dog ✗, flagged ✗, below threshold ✗)
- [ ] `GET /posts/:id/images`, the `/check` endpoint, `NO_CONFIDENT_MATCH`
- **GATE:** fox post ranks the fox first; the guard refuses the wolf

## Phase 4 · Production layer (≈8–12 h)
- [ ] Review endpoints + HTML table + idempotency keys
- [ ] Eval set written, eval script + threshold sweep, results committed
- [ ] README: overview, diagram, run + seed steps, precision number, limitations
- [ ] `capstone.yaml` complete; fresh-clone test with `docker compose up` on a clean machine
- **GATE:** eval precision measured and quoted in the README

## Section 6 checklist → where it gets proven

| Requirement | Phase | Evidence (EVIDENCE.md) |
|---|---|---|
| Schema-validated vision output | 2 | unit test `rejects invalid model output` + log line of a retried invalid response |
| Low-confidence flagged | 2 | `GET /images?status=flagged` curl |
| Batch job with retries | 2 | job log showing attempt 2 succeeding |
| Cost per call | 2 | `GET /costs/summary` curl |
| Embeddings stored, ranked suggestions | 3 | `GET /posts/:id/images` curl |
| Synonym matching | 3 | "Vulpes vulpes" post → fox ranked first |
| Guard rejects wolf | 3 | `/check` curl → SUBJECT_MISMATCH |
| Human-readable rejections | 3 | same output |
| No confident match | 3 | penguin post curl |
| DB models + indexes | 2–3 | migration file + `\d+` output |
| Validated API + review flow | 4 | 400 curl on bad input; approve/reject/inspect curls |
| Eval top-1 precision in README | 4 | `npm run eval` output |
| README + required files | 4 | file listing |

## Acceptance probes → checks

| Probe | How it gets demonstrated |
|---|---|
| 1 Tagging + flag | `POST /jobs/ingest-images` → `/jobs/:id` shows flagged ≥ 1 |
| 2 Fox first | `GET /posts/{red-fox}/images` |
| 3 Wolf refused | `POST /posts/{red-fox}/images/{wolf}/check` |
| 4 No match | `GET /posts/{penguins}/images` |
| 5 Eval = README | `npm run eval` |
| 6 Cost log | `GET /costs` row count ≥ AI calls made |

## Shared requirements → design answer

| # | Requirement | Where |
|---|---|---|
| 1 | Layered architecture | routes / services / repositories + providers ([DESIGN.md](DESIGN.md)) |
| 2 | Validation → 4xx | Zod middleware + central error handler ([SPEC.md](SPEC.md#api)) |
| 3 | Background job, retries, alert | pg-boss jobs, `retryLimit`, alert on final failure |
| 4 | Persistence, migrations, indexes, tenants | Drizzle migrations, `workspace_id` scoping ([SPEC.md](SPEC.md#data-model)) |
| 5 | Idempotency | content-hash ingestion, post slug, review `Idempotency-Key`, pg-boss `singletonKey` |
| 6 | Secrets clean | `.env` only, API keys stored hashed, logger redacts `key`/`authorization` |
| 7 | Cost + budget guard | `ai_calls` + `AI_BUDGET_USD` / `AI_MAX_CALLS_PER_DAY` checked before each call |

## Stretch (only after everything above is green)
Pick **one**: a test suite (partly done already via the guard tests) → alt-text generation → near-duplicate
detection via embedding distance.
