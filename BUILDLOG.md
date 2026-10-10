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

## 2026-10-09 · Phase 3: matching engine & mismatch guard

**Done:** pgvector (custom migration to enable the extension, then posts, image/post embeddings with HNSW cosine
indexes, and a suggestions table); post subject extraction (Flash, Zod-validated like vision output); embedding jobs
for images (chained automatically after tagging, plus a backfill endpoint) and posts; the mismatch guard as a pure
module (rules R1–R5, every failure explained); `GET /posts/:id/images` (rank → guard → store → explain) and the forced
`/check` endpoint; 7 demo posts seeded by `seed`; 76 tests.

**Result:** fox post → foxes accepted, best wolf #13 and best dog #15 rejected. The "Vulpes vulpes" post (never says
"red fox") → foxes. Forced wolf → "Subject mismatch: expected red fox, detected gray wolf". Penguin and sourdough posts
→ NO_CONFIDENT_MATCH with reasons. An arctic-fox post refused a red fox even at similarity 0.61.

**Where AI helped:** Claude Code designed and wrote the guard, the ranking query and the jobs, and ran every probe live.

**Where AI was wrong or needed correcting:**
- **The starting thresholds were guesses and they were wrong.** With T_SIM 0.70 every post, including the fox post,
  returned NO_CONFIDENT_MATCH: this embedding model scores a long post against a one-line caption at 0.54–0.69 even for
  the right animal. The thresholds were lowered to 0.55 / 0.65 from the observed numbers (decision #18). That's still
  provisional until the Phase 4 sweep. Lesson: the brief is right that thresholds come from data, not intuition.
- It first marked a failed *embedding* by reusing the "attempt failed" method, which would have reset an already tagged
  image to `pending`. Caught in review and replaced with a method that only records the error.
- The Gemini SDK's embedding response has no token usage, so embeddings call the REST endpoint directly to keep cost
  tracking real.
- Candidates that passed the guard but fell outside the top 3 were silently missing from the response; the count is now
  returned as `alsoPassedNotShown`.

**Honest notes:** the snowy fox (`red-fox-09`) ranks first for both fox posts; its caption mentions the snow and fur,
which the post text also describes. The guard depends on the model's labels: if vision mislabels an image, the subject
rule trusts that label (which is why low-confidence images are flagged).

## 2026-10-09 · Phase 4: review workflow, eval & hardening

**Done:** review workflow (`review_actions` with stored responses; approve/reject require an `Idempotency-Key`; same
key replays, a new key on a decided suggestion → 409, a reused key for another request → 422, approving a
guard-rejected pairing → 409); `GET /suggestions/:id` explains any decision with the exact thresholds stored on it;
a minimal `/review.html` page with thumbnails; a 16-post labeled eval set; `npm run eval` (+ `--sweep`) with a
"ranking only" baseline; final README, EVAL_RESULTS.md and evidence; 88 tests.

**Result:** top-1 precision **100% (11/11)**, 5/5 unanswerable posts refused, 0 wrong accepts. Without the guard,
ranking alone gets 72.7% and offers an image for every unanswerable post.

**Where AI helped:** Claude Code wrote the review service, the eval script and sweep, the eval posts, and the docs,
and ran every check live.

**Where AI was wrong or needed correcting / what I learned:**
- The Phase 3 threshold (0.55) still made both dog posts abstain (81.8%). The sweep showed 0.40–0.48 all reach 100%
  with no wrong accepts, so 0.48 was chosen by the rule written *before* the sweep (highest of the ties), not by
  picking the prettiest number afterwards.
- The eval exposed a real weakness: for generic dog posts the embedding ranks a **black bear above every dog**. The
  guard's subject rule rescues it, but the accepted dog clears the threshold by only 0.01. That's documented as a
  limitation rather than hidden.
- A server-rendered review table can't send the API-key header from a browser; the page became a static shell that
  calls the same JSON endpoints (decision #22).
- Adding a NOT NULL `guard_config` column to a table that already had 73 rows would have failed the migration; the
  generated SQL was edited to backfill `{}` first.

**Fresh-clone test (2026-10-10), the most useful hour of the project:** running the committed files on an empty
database re-tagged everything, and two things that "worked on my machine" turned out to be luck:
- Probe 1 depended on a single image whose confidence moved between runs (0.65 → 0.75 → 0.68 at temperature 0).
  At `T_CONF` 0.70 the first clean run flagged **nothing**. I chose to raise `T_CONF` to 0.80, into the gap between
  that ambiguous image and every clear one (≥ 0.85), rather than add synthetic images.
- At `T_SIM` 0.48 a re-tagged dog post fell to 0.474 and abstained (90.9%). Applying the same threshold rule to both
  runs gave 0.46, which is 100% on both. The README now reports both runs and says a third could differ.
