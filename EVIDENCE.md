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

- [ ] **Vision and embedding costs are tracked per call** — *vision done; embedding calls arrive in Phase 3*

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
- [ ] Image and post embeddings are stored; posts return ranked image suggestions
- [ ] Semantic matching works for equivalent concepts ("red fox" matches "Vulpes vulpes")

## Safety layer
- [ ] The mismatch guard rejects incorrect recommendations (the wolf-on-a-fox-post scenario provably fails)
- [ ] Rejections include a human-readable explanation
- [ ] When no image clears the bar, the system answers "no confident match" with reasons

## Backend
- [ ] Database models for images, tags, embeddings, posts, suggestions, approvals/rejections, with the required indexes
- [ ] API endpoints validated; the review workflow (approve / reject / inspect why) exists

## Quality & documentation
- [ ] A small labeled evaluation dataset measures top-1 precision, and the number is in the README
- [ ] README with architecture explanation and diagram; the required files present

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
