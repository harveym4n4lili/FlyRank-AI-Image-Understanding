# Build Log

An honest log of the build: what was done, where AI helped, where it was wrong, and what I changed.

## 2026-10-09 · Phase 0 + planning

**Done:** read the brief; wrote the planning docs (design, spec, guard and eval plan, roadmap); set up the
repo, TypeScript/Express/Drizzle/pg-boss skeleton, Docker Compose (Postgres + pgvector, api, worker),
lint and tests.

**Where AI helped:** Claude Code drafted the planning docs from the brief and generated the project
skeleton (env validation, error handling, health route, Dockerfile, compose file, first tests).

**Where AI was wrong or needed correcting:**
- The first docs draft was split into 8 files, which was too fragmented. I asked for them to be merged into 4.
- It assumed Docker Desktop lived in `C:\Program Files`. Mine is a per-user install, so it had to find the real path.
- The docs said Node 20; updated to Node 24 to match the installed LTS.

**What I need to be able to explain:** why `subject_label` exists in addition to `subject` (see
docs/GUARD_AND_EVAL.md), and why the app is built with `createApp(deps)` (so tests run without a database).

## 2026-10-09 · Phase 1: design, taxonomy, corpus

**Done:** finalized the subject-label taxonomy (`src/config/taxonomy.ts`, with tests for fox ≠ wolf and
generic → specific matching); hand-picked 50 Pexels images (10 each of red fox, gray wolf, dog, bear, deer,
including the planned hard cases); wrote `npm run corpus:download` (validate → download → resize to ≤ 800px);
downloaded and checked the images; committed them (3.6 MB).

**Where AI helped:** Claude Code wrote the taxonomy, the download script and the doc updates, formatted my
links into manifest entries, and checked each page title before adding it.

**Where AI was wrong or needed correcting:**
- It built a Pexels API auto-search script before checking whether Pexels was issuing keys. It wasn't
  (issuance paused), so the script was deleted and I picked every image by hand.
- Its first fallback relied on Unsplash's page download link, which was rate-limited (HTTP 429). The corpus ended up Pexels-only.
- The first schema required a photographer name for every entry. Neither license requires attribution, so the field was dropped.

**My corrections to the AI's suggestions / my own picks:** a "two jackals" photo got into my red-fox batch and
the title check caught it, so I swapped it. I sent a batch of mixed fox species as "gray fox" when the plan needed
gray *wolves*, and replaced it with real wolves.

## 2026-10-09 · Phase 2: image understanding pipeline

**Done:** Drizzle schema + first migration (workspaces, ingest_batches, images, image_tags, ai_calls, with indexes);
seed script; Gemini vision provider with JSON-schema structured output; Zod validation of every response; flagging
rule; per-call cost log + daily budget guard; pg-boss ingest job (retries with backoff, dead-letter queue, failure
alert, idempotent re-runs); API-key auth; /jobs, /images, /costs endpoints; 47 tests.

**Result:** all 50 images processed on the first run: 49 tagged, 1 flagged (dog-09, "wolfdog", confidence 0.65).
Labels match my manifest on 49/50. Notional cost $0.036 for 50 calls, billed $0.

**Where AI helped:** Claude Code wrote the pipeline, chose the models by sending each candidate a tiny test call, and
proved retries live by running a worker against a non-existent model on a throwaway image.

**Where AI was wrong or needed correcting:**
- `gemini-2.5-flash` (the model I'd have guessed) returns 404 for new users, so it had to probe the available models
  rather than assume.
- The first worker log said "will retry" even on the final attempt; it was fixed to say when a job is moving to the dead-letter queue.
- A log-tailing monitor lagged behind the real progress and made it look like the worker was stuck; querying the database directly showed it was fine.
- Services originally imported the HTTP error class (a layering violation); this was moved to `src/lib/errors.ts`.

**Surprises / honest notes:**
- `red-fox-09` (meant to be the "distant fox in snow" hard case) was tagged with 0.95 confidence. The fox is clearly
  visible, so it isn't really a hard case. The low-confidence requirement is still met by dog-09.
- The model's self-reported confidence is high almost everywhere (0.90–0.99); only one image fell below 0.70. Calibration
  is something to watch in Phase 4.
- Prices in `src/config/pricing.ts` are notional assumptions, not verified list prices.
