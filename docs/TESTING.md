# Manual Testing: Is Each Phase Really Done?

A short, hands-on checklist per phase. Run it after finishing a phase (and again before submitting).
Every box should pass by **looking at real output**, not by trusting that the code exists. Paste the
interesting outputs into `EVIDENCE.md`.

**Setup for every phase** (Git Bash, from the repo root, Docker Desktop running):

```bash
docker compose up --build -d
export KEY=$(grep ^DEMO_API_KEY= .env | cut -d= -f2- | tr -d '\r')
export B=http://localhost:3000
```

> ✅ = what you should see. ❌ = the phase is not done.

---

## Phase 0 · Repo & skeleton

- [ ] The GitHub repo is **public** (open it in a private browser window without logging in).
- [ ] `git check-ignore .env` → ✅ prints `.env`.
- [ ] `git log -p | grep -iE "GEMINI_API_KEY=AI|DEMO_API_KEY=imk_"` → ✅ prints nothing (no secrets in history).
- [ ] `docker compose ps` → ✅ `db` healthy; `api` and `worker` running; `migrate` exited (0).
- [ ] `curl $B/health` → ✅ `{"status":"ok","db":true}`.
- [ ] `npm test && npm run lint && npm run typecheck` → ✅ all pass.
- [ ] README, `capstone.yaml`, `EVIDENCE.md`, `BUILDLOG.md`, `.env.example`, `LICENSE` all exist.

## Phase 1 · Design & corpus

- [ ] `docs/DESIGN.md` exists and includes the problem, data model, API, layers and a non-goal.
- [ ] `npm run corpus:download` → ✅ `Downloaded 0, skipped 50, failed 0`; per-label counts add up to 10 per animal.
- [ ] `ls data/images | wc -l` → ✅ `50`; `du -sh data/images` → ✅ under ~5 MB.
- [ ] Open 5 random images, including the hard cases (`red-fox-09`, `dog-09`, `white-tailed-deer-06`) → ✅ each matches its label in `data/manifest.json`.
- [ ] `npx vitest run test/taxonomy.test.ts` → ✅ passes (fox ≠ wolf, generic `fox` accepts `red_fox`).

## Phase 2 · Image understanding pipeline

**Database & auth**
- [ ] `docker compose exec -T db psql -U app -d imagematch -c "\dt"` → ✅ `workspaces, ingest_batches, images, image_tags, ai_calls`.
- [ ] `docker compose exec -T api node dist/db/seed.js` → ✅ `Seeded workspace "demo"`.
- [ ] `curl $B/images` (no key) → ✅ `401 UNAUTHENTICATED`.
- [ ] `curl -H "X-Api-Key: $KEY" "$B/images?status=bogus"` → ✅ `400 VALIDATION_FAILED` (never 500).
- [ ] `curl -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d '{"dir":"../src"}' $B/jobs/ingest-images` → ✅ 400.

**Batch job** (on a fresh database: `docker compose down -v`, then setup and seed again)
- [ ] `curl -X POST -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d '{}' $B/jobs/ingest-images`
      → ✅ **202** right away with `{"jobId":…,"total":50,"enqueued":50}`.
- [ ] `curl -H "X-Api-Key: $KEY" $B/jobs/<jobId>` a few times → ✅ `progress` rises; ends `"state":"completed"`, `"failed":0` (about 7 minutes).
- [ ] `curl -H "X-Api-Key: $KEY" "$B/images?status=flagged"` → ✅ **at least 1** image, with a `flagReason`.
- [ ] `curl -H "X-Api-Key: $KEY" "$B/images?status=pending"` → ✅ `"count":0` (nothing stuck).
- [ ] Spot-check 3 images: `curl -H "X-Api-Key: $KEY" $B/images/<id>` → ✅ subject, caption and attributes are correct.

**Idempotency, costs, retries**
- [ ] Run the same POST again → ✅ `"enqueued":0,"skipped":50`, and `/costs/summary` `totals.calls` is unchanged.
- [ ] `curl -H "X-Api-Key: $KEY" $B/costs/summary` → ✅ `calls` ≥ number of images; `costUsd` > 0; `billedUsd` 0; budget numbers present.
- [ ] `curl -H "X-Api-Key: $KEY" "$B/costs?limit=3"` → ✅ each row has `model`, tokens, `costUsd`, `subjectId`, `attempt`, `outcome`.
- [ ] *(Optional, retry check)* stop the worker, run `docker compose run -d --name bad-worker -e GEMINI_VISION_MODEL=nope worker`,
      ingest a folder with one new image → ✅ logs show 4 attempts, then `failed after all retries (alert=true)`; image `failed`.
      Then `docker rm -f bad-worker`, `docker compose up -d worker`, and re-ingest → ✅ the image becomes `tagged`. Delete the test image afterwards.

## Phase 3 · Matching engine & guard

*To be run once Phase 3 is built (endpoints from [SPEC.md](SPEC.md#api)).*

- [ ] `docker compose exec -T api node dist/db/seed.js` → ✅ `Demo posts: 7 created` (first run); wait ~1 min, then
      `curl -H "X-Api-Key: $KEY" $B/posts` → ✅ all 7 `"status":"embedded"` with a `subjectLabel`.
- [ ] `docker compose exec -T db psql -U app -d imagematch -c "select count(*) from image_embeddings"` → ✅ 50
      (if not: `curl -X POST -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d '{}' $B/jobs/embed-images`).
- [ ] `POST /posts` with a new post → ✅ 201; sending the same `slug` again → ✅ 200, no duplicate.
- [ ] `GET /posts/<id>/images` before embedding finishes → ✅ 409; afterwards → ✅ 200.
- [ ] **Probe 2:** `GET /posts/<red-fox-behaviour id>/images?limit=20` → ✅ `"result":"MATCH"`, rank 1 is a `red-fox-*` image;
      the best `gray-wolf-*` and `dog-*` sit far below (≈ #13 / #15) and are `REJECTED`.
- [ ] **Probe 3:** `POST /posts/<fox-post>/images/<a gray-wolf id>/check` → ✅ `REJECTED` with `SUBJECT_MISMATCH` "expected red fox, detected gray wolf".
- [ ] **Synonyms:** `vulpes-vulpes-field-guide` (never says "red fox") → ✅ `subjectLabel` `red_fox`, foxes accepted.
- [ ] **Near-miss:** create an arctic-fox post → ✅ `NO_CONFIDENT_MATCH` ("expected arctic fox, detected red fox") even though similarity clears `T_SIM`.
- [ ] **Probe 4:** `emperor-penguin-winter` and `sourdough-starter-basics` → ✅ `"result":"NO_CONFIDENT_MATCH"` with readable reasons
      (subject mismatch / category mismatch / similarity below threshold).
- [ ] The flagged image (`dog-09`) never appears as an `ACCEPTED` suggestion → ✅ rejected with "flagged for review".
- [ ] Every `REJECTED` item has at least one `reasons[].message` a non-technical person could understand.
- [ ] `/costs/summary` → ✅ now also has `embed` rows (and `post_extract`); the "vision **and embedding** costs" evidence box can be ticked.

## Phase 4 · Review, eval & submission

- [ ] Open `http://localhost:3000/review.html`, paste the API key, **Load** → ✅ a table of pending suggestions with thumbnails and reasons;
      **Approve** on one row → ✅ the row shows `approved`.
- [ ] `curl -H "X-Api-Key: $KEY" "$B/review?verdict=ACCEPTED"` → ✅ JSON list; `curl $B/review` (no key) → ✅ 401.
- [ ] `POST /suggestions/<id>/approve` with header `Idempotency-Key: k1`, twice → ✅ the same response both times and only **one** review action stored.
- [ ] The same with a different key on that already-decided suggestion → ✅ 409 `ALREADY_DECIDED`; the same key for a different
      suggestion → ✅ 422; approving a guard-`REJECTED` suggestion → ✅ 409 `GUARD_REJECTED`; no `Idempotency-Key` → ✅ 400.
- [ ] `GET /suggestions/<id>` → ✅ shows why: reasons, thresholds used, similarity, review history.
- [ ] **Probe 5:** `npm run eval` → ✅ prints `Top-1 precision: 100.0% (11/11)`, the **same number** as the README; `-- --sweep` prints the table in `docs/EVAL_RESULTS.md`.
      (On a freshly tagged database the exact top-1 picks can differ; see EVAL_RESULTS → Reproducibility.)
- [ ] **Probe 6:** each vision/embedding call has a row in `GET /costs`.
- [ ] Fresh-clone test: clone into a new folder → `cp .env.example .env` (add your Gemini key) → run `run:` and `seed:`
      from `capstone.yaml` → ingest → ✅ the Phase 2 and 3 checks above pass with no manual fixes.
- [ ] Every box in `EVIDENCE.md` is ticked with pasted output; BUILDLOG has an entry per phase.
- [ ] README has the architecture diagram, run + seed steps, the precision number and an honest Limitations section.
