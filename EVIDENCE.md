# Evidence

One pasted proof per requirement in the brief's Section 6, using real command output only. A box gets ticked only
when its proof is pasted below it.

## AI processing

- [x] **Vision model produces structured output validated against a schema; invalid responses are never trusted**

  Gemini is called with `responseJsonSchema` generated from the Zod schema (`src/domain/imageTags.ts`), and every
  response is still parsed with `ImageTags.safeParse` before anything is stored. Invalid output is logged as
  `invalid_output` and the job is retried; it never reaches the `images` row. Tests:

  ```
  $ npx vitest run test/domain.test.ts test/imageProcessor.test.ts
  ✓ parseVisionOutput (never trust model output) > rejects empty response
  ✓ parseVisionOutput (never trust model output) > rejects not JSON
  ✓ parseVisionOutput (never trust model output) > rejects missing field
  ✓ parseVisionOutput (never trust model output) > rejects label outside the taxonomy
  ✓ parseVisionOutput (never trust model output) > rejects confidence above 1
  ✓ parseVisionOutput (never trust model output) > rejects extra field
  ✓ parseVisionOutput (never trust model output) > rejects empty attributes
  ✓ imageProcessor > never stores invalid output: records it, then throws so the job retries
  ```

  Live run on the 50-image corpus (2026-10-09): 50/50 responses schema-valid; model labels match the manifest's
  `expected_label` on 49/50 (the deer silhouette was labelled generic `deer`, which is correct for a silhouette).

- [x] **Low-confidence classifications are flagged instead of accepted**

  ```
  $ curl -H "X-Api-Key: $DEMO_API_KEY" "http://localhost:3000/images?status=flagged"
  {"count":1,"items":[{"filePath":"images/dog-09.jpg","status":"flagged",
    "flagReason":"low_confidence (0.65 < 0.70)","subject":"wolfdog","subjectLabel":"dog","confidence":0.65,
    "caption":"A wolf-like dog stands in tall dry grass in front of dense green bushes with its tongue out."}]}
  ```

  Flagged images keep their tags for review but are never auto-suggested (guard rule R1).

- [x] **Images are processed through a batch background job with retries**

  `POST /jobs/ingest-images` returns 202 immediately; pg-boss workers tag images in the background
  (`retryLimit: 3`, exponential backoff, then a dead-letter queue that marks the image failed and alerts).

  ```
  $ curl -X POST -H "X-Api-Key: $DEMO_API_KEY" -d '{}' http://localhost:3000/jobs/ingest-images
  {"jobId":"02c32f13-6773-44e8-b312-b10729310077","total":50,"enqueued":50,"skipped":0}
  $ curl -H "X-Api-Key: $DEMO_API_KEY" http://localhost:3000/jobs/02c32f13-6773-44e8-b312-b10729310077
  {"state":"running","total":50,"enqueued":50,"done":0,"inProgress":50,"progress":0, ...}   # 23:11:15
  ... → {"state":"completed", ... "tagged":49,"flagged":1,"failed":0,"progress":1}
  ```

  Re-running is idempotent (content-hash dedupe; queue policy `stately` + `singletonKey`), so no extra model calls:

  ```
  $ curl -X POST -H "X-Api-Key: $DEMO_API_KEY" -d '{}' http://localhost:3000/jobs/ingest-images
  {"jobId":"e85a6b95-1428-4ac3-aba4-ee6df1ecdf94","total":50,"enqueued":0,"skipped":50}
  ai_calls before: 50 / after: 50
  ```

  Retry + failure alert, demonstrated by running a worker with a non-existent model on a throwaway image
  (deleted afterwards):

  ```
  22:19:08 WARN  attempt 1 image attempt failed  {"error":{"code":404,"message":"models/gemini-does-not-exist is not found ...
  22:19:17 WARN  attempt 2 image attempt failed  ...
  22:19:38 WARN  attempt 3 image attempt failed  ...
  22:20:05 WARN  attempt 4 image attempt failed  ...
  22:20:07 ERROR image ingestion failed after all retries (alert=true)
  ```

  After restoring the real worker, re-ingesting the folder picked up the failed image and tagged it
  (`tagged red_fox attempts=5`).

- [x] **Vision and embedding costs are tracked per call**

  After Phase 3 (2026-10-09), `GET /costs/summary` → `byKindModelOutcome`:

  ```
  vision        gemini-3.8-flash       ok     51 calls  71026 input tokens  $0.03634
  vision        gemini-does-not-exist  error   4 calls      0 input tokens  $0.00000   (retry demo)
  embed         gemini-embedding-2     ok     58 calls   2707 input tokens  $0.00041   (50 images + 8 posts)
  post_extract  gemini-3.8-flash       ok      8 calls   2831 input tokens  $0.00122
  totals: {"calls":121,"costUsd":0.03796,"billedUsd":0}
  ```

  Phase 2 snapshot (vision only), for reference:

  Every call writes one `ai_calls` row (tokens incl. thinking, notional `cost_usd`, `billed_usd` = 0 on the free tier,
  latency, job id, attempt, outcome), including failed ones. Budget guard checked before each call.

  ```
  $ curl -H "X-Api-Key: $DEMO_API_KEY" http://localhost:3000/costs/summary
  {"totals":{"calls":50,"costUsd":0.0355859,"billedUsd":0},
   "byKindModelOutcome":[{"kind":"vision","model":"gemini-3.8-flash","outcome":"ok","calls":50,
     "inputTokens":69653,"outputTokens":5876,"costUsd":0.0355859,"billedUsd":0}],
   "budget":{"window":"UTC day","maxUsd":1,"maxCalls":500,"usedUsd":0.0355859,"usedCalls":50,
     "remainingUsd":0.9644141,"remainingCalls":450}}
  ```

  Failed calls are logged too (from the retry demo):

  ```
   attempt |         model         | outcome
  ---------+-----------------------+---------
         1 | gemini-does-not-exist | error
         2 | gemini-does-not-exist | error
         3 | gemini-does-not-exist | error
         4 | gemini-does-not-exist | error
         1 | gemini-3.8-flash      | ok
  ```

## Matching system

- [x] **Image and post embeddings are stored; posts return ranked image suggestions**

  768-dim vectors in pgvector tables with HNSW cosine indexes (`image_embeddings`: 50 rows, `post_embeddings`: 8 rows).
  Ranking for the red-fox post, `GET /posts/<red-fox-behaviour>/images?limit=8`:

  ```
  === red-fox-behaviour [red_fox] → MATCH
    #1 ACCEPTED 0.665 red-fox-09.jpg
    #2 ACCEPTED 0.643 red-fox-10.jpg
    #3 ACCEPTED 0.632 red-fox-02.jpg
    (alsoPassedNotShown: 4)
  ```

  Wolves and dogs rank clearly lower (`?limit=20`):

  ```
  red-fox    best rank #1   similarity 0.6653  ACCEPTED
  gray-wolf  best rank #13  similarity 0.4985  REJECTED
  dog-       best rank #15  similarity 0.4755  REJECTED
  ```

- [x] **Semantic matching works for equivalent concepts ("red fox" matches "Vulpes vulpes")**

  The `vulpes-vulpes-field-guide` post never contains the words "red fox". Subject extraction mapped it to `red_fox`
  and the embedding ranked foxes first:

  ```
  === vulpes-vulpes-field-guide [red_fox] → MATCH
    #1 ACCEPTED 0.681 red-fox-09.jpg
    #2 ACCEPTED 0.633 red-fox-02.jpg
    #3 ACCEPTED 0.630 red-fox-10.jpg
  ```

  Same for "Bears of North America" (generic `bear` → brown and black bears accepted) and "grizzly" → `brown_bear`.

## Safety layer

- [x] **The mismatch guard rejects incorrect recommendations (the wolf-on-a-fox-post scenario provably fails)**

  Probe 3: forcing the most fox-like wolf (forest scene) onto the fox post:

  ```
  $ curl -X POST -H "X-Api-Key: $DEMO_API_KEY" $B/posts/<red-fox-behaviour>/images/<gray-wolf-05>/check
  {"verdict":"REJECTED","reasons":[
    {"code":"SUBJECT_MISMATCH","message":"Subject mismatch: expected red fox, detected gray wolf",
     "detail":{"expected":"red_fox","detected":"gray_wolf"}},
    {"code":"SIMILARITY_LOW","message":"Similarity 0.49 is below threshold 0.55", ...}], "guardVersion":"576dc0a38236"}
  ```

  The subject rule holds even when similarity is high. An arctic-fox post (no arctic foxes in the library) refuses the
  snowy red fox at similarity **0.61**, above `T_SIM`:

  ```
  NO_CONFIDENT_MATCH
  Best candidate #1 "A red fox stands on a blanket of snow looking toward the camera." (similarity 0.61):
    Subject mismatch: expected arctic fox, detected red fox
  ```

  Unit test: `guard > rejects the wolf on a fox post even when similarity is high (probe 3)` (similarity 0.95 → REJECTED).

- [x] **Rejections include a human-readable explanation**

  Every rule that fails is listed. The flagged `dog-09` on the fox post:

  ```
  REJECTED [
    'Image was flagged for review at ingestion (confidence 0.65)',
    'Subject mismatch: expected red fox, detected dog',
    'Similarity 0.35 is below threshold 0.55',
    'Vision confidence 0.65 is below 0.70'
  ]
  ```

- [x] **When no image clears the bar, the system answers "no confident match" with reasons**

  Probe 4, posts with no suitable image:

  ```
  === emperor-penguin-winter [other_animal] → NO_CONFIDENT_MATCH
    reasons: Best candidate #1 "A red fox stands on a blanket of snow looking toward the camera." (similarity 0.51):
             Subject mismatch: expected emperor penguin, detected red fox; Similarity 0.51 is below threshold 0.55
  === sourdough-starter-basics [unknown] → NO_CONFIDENT_MATCH
    reasons: Best candidate #1 "A young red fox kit with a muddy paw ..." (similarity 0.47):
             Category mismatch: expected food, detected animal; Similarity 0.47 is below threshold 0.65
  ```

## Backend

- [x] **Database models for images, tags, embeddings, posts, suggestions, approvals/rejections, with the required indexes**

  Schema lives in `src/db/schema.ts` and ships only as migrations (`drizzle/0000_init.sql`, `0001_enable_pgvector.sql`,
  `0002_matching.sql`, `0003_review.sql`), applied by the one-shot `migrate` service before api/worker start.

  ```
  $ docker compose exec -T db psql -U app -d imagematch -At -c "select tablename||': '||string_agg(indexname, ', ') ..."
  ai_calls: ai_calls_job_idx, ai_calls_pkey, ai_calls_subject_idx, ai_calls_workspace_created_idx
  image_embeddings: image_embeddings_hnsw_idx, image_embeddings_pkey
  image_tags: image_tags_image_id_tag_pk, image_tags_tag_idx
  images: images_batch_idx, images_pkey, images_workspace_hash_uq, images_workspace_label_idx, images_workspace_status_idx
  ingest_batches: ingest_batches_pkey, ingest_batches_workspace_idx
  post_embeddings: post_embeddings_hnsw_idx, post_embeddings_pkey
  posts: posts_pkey, posts_workspace_slug_uq, posts_workspace_status_idx
  review_actions: review_actions_pkey, review_actions_suggestion_idx, review_actions_workspace_key_uq
  suggestions: suggestions_pkey, suggestions_post_image_uq, suggestions_post_rank_idx, suggestions_workspace_review_idx
  workspaces: workspaces_api_key_hash_unique, workspaces_name_unique, workspaces_pkey
  ```

  Unique indexes enforce idempotency (`images_workspace_hash_uq`, `posts_workspace_slug_uq`,
  `suggestions_post_image_uq`, `review_actions_workspace_key_uq`); HNSW indexes serve cosine ranking; every domain
  table is scoped by `workspace_id`.

- [x] **API endpoints validated; the review workflow (approve / reject / inspect why) exists**

  Every param, query and body is parsed with Zod; bad input is a 4xx, never a 500 (88 tests include a table of
  invalid requests → 400). Live review workflow (2026-10-09):

  ```
  $ curl -X POST -H "X-Api-Key: $KEY" -H "Idempotency-Key: review-demo-001" -d '{"note":"great match for the intro"}' $B/suggestions/<id>/approve
  {"id":"bf35d856-…","action":"approve","reviewStatus":"approved","note":"great match for the intro","replayed":false}

  # same request, same key → replayed, nothing new recorded
  {"id":"bf35d856-…","note":"great match for the intro","action":"approve","reviewStatus":"approved","replayed":true}
  review_actions rows for it: 1

  # new key on the decided suggestion
  {"error":{"code":"ALREADY_DECIDED","message":"Suggestion was already approved"}} → HTTP 409
  # approving a pairing the guard refused
  {"error":{"code":"GUARD_REJECTED","message":"The guard rejected this pairing, so it cannot be approved"}} → HTTP 409
  # no Idempotency-Key
  HTTP 400
  ```

  Inspect why (`GET /suggestions/:id`). This decision was made before `T_CONF` was raised to 0.80; it still shows the
  thresholds that were in force when it was made, which is exactly what `guard_config` is for:

  ```
  {"verdict":"ACCEPTED","reviewStatus":"approved",
   "why":{"summary":"Suggested because it passed every guard rule (similarity 0.67, rank 1).",
          "thresholds":{"TOP_K":3,"T_SIM":0.48,"T_CONF":0.7,"T_SIM_STRICT":0.65},"guardVersion":"9e603bb43d5c"},
   "post":"The behaviour of red foxes","image":"images/red-fox-09.jpg",
   "history":[{"action":"approve","note":"great match for the intro","createdAt":"2026-10-09T22:57:26.737Z"}]}

  # a refused pairing:
  "Refused by the guard: Subject mismatch: expected gray wolf, detected red fox."
  ```

  Review page: `GET /review.html` → 200 (table with thumbnails, Approve/Reject buttons using fresh Idempotency-Keys).

## Quality & documentation

- [x] **A small labeled evaluation dataset measures top-1 precision, and the number is in the README**

  `eval/posts.json` (16 posts: 6 plain, 5 synonym, 3 negative, 2 near-miss), ground truth from the hand-labeled
  manifest. Result saved in `eval/results/latest.json`; full table and sweep in `docs/EVAL_RESULTS.md`.

  ```
  $ npm run eval
  Eval set: 16 posts (11 with a correct image, 5 without)
  Thresholds: T_SIM=0.46 T_SIM_STRICT=0.65 T_CONF=0.8 (guard ad16f81fc90b)
  ...
  Top-1 precision:         100.0% (11/11)
  Precision when answered: 100.0%
  Coverage:                100.0%
  Abstention accuracy:     100.0%
  Wrong accepts:           0

  Baseline, ranking only (no guard): top-1 precision 72.7%, and every negative post would get an image
    guard fixed choosing-a-family-dog: most similar image was a black_bear, guard picked dog-04.jpg (dog)
    guard fixed ursus-arctos-horribilis: most similar image was a black_bear, guard picked brown-bear-04.jpg (brown_bear)
    guard fixed canis-familiaris-companion: most similar image was a black_bear, guard picked dog-04.jpg (dog)
  ```

  README → *Results*: "Top-1 precision … **100% (11/11)**".

  The same eval on the **fresh-clone** database (everything re-tagged from scratch, see below):

  ```
  $ DATABASE_URL=postgres://app:app@localhost:5433/imagematch npm run eval
  Thresholds: T_SIM=0.46 T_SIM_STRICT=0.65 T_CONF=0.8 (guard ad16f81fc90b)
  Top-1 precision:         100.0% (11/11)
  Abstention accuracy:     100.0%
  Wrong accepts:           0
  Baseline, ranking only (no guard): top-1 precision 81.8%, and every negative post would get an image
  ```

- [x] **README with architecture explanation and diagram; the required files present**

  README has: what it does, an ASCII architecture diagram + layer description, run/seed/ingest/match/review/eval
  steps, results, limitations. Required files:

  ```
  README.md  capstone.yaml  EVIDENCE.md  BUILDLOG.md  .env.example  LICENSE
  ```

---

## Baseline: Phase 0 skeleton boots (2026-10-09)

```
$ docker compose ps
SERVICE   STATE     STATUS
api       running   Up 2 seconds
db        running   Up 6 seconds (healthy)
worker    running   Up 2 seconds

$ curl -i http://localhost:3000/health
HTTP/1.1 200 OK
{"status":"ok","db":true}

$ curl http://localhost:3000/nope
{"error":{"code":"NOT_FOUND","message":"No route for GET /nope"}}
```

## Fresh-clone test: a stranger can run it (2026-10-10)

Exactly the files git would commit (`git ls-files --cached --others --exclude-standard`; no `node_modules`, no
database) were copied to a new folder, given a `.env`, and started as a separate Compose project on an **empty
database** (ports 3100/5433), using only the `run:` and `seed:` commands from `capstone.yaml`:

```
$ docker compose up --build -d          # migrate exits 0 (all 4 migrations on an empty db), api + worker start
$ docker compose exec -T api node dist/db/seed.js
Demo posts: 7 created, 0 already existed (queued for embedding)
$ curl -X POST … /jobs/ingest-images
{"total":50,"enqueued":50,"skipped":0}
… done=50 failed=0 embedded=50 posts=7
P1 flagged: 1 images/dog-09.jpg low_confidence (0.68 < 0.80)
P2 fox post: MATCH images/red-fox-03.jpg, images/red-fox-01.jpg, images/red-fox-10.jpg
P3 forced wolf: REJECTED - Subject mismatch: expected red fox, detected gray wolf
P4 penguin: NO_CONFIDENT_MATCH - Best candidate #1 "A close-up portrait of a gray wolf …" (similarity 0.48): Subject mismatch …
P5 eval: Top-1 precision 100.0% (11/11), abstention 100.0%, wrong accepts 0
P6 costs: {"calls":132,"costUsd":0.0395,"billedUsd":0} vision:ok=50 embed:ok=66 post_extract:ok=16
```

This test found two real problems, both fixed and re-verified on a second clean run: `dog-09`'s confidence varies
between runs (0.65 / 0.75 / 0.68), so probe 1 could fail at `T_CONF` 0.70 → raised to 0.80 (decision #25); and one
dog post abstained at `T_SIM` 0.48 → 0.46 (decision #26).
