# API Contract

Base URL: `http://localhost:3000`. All endpoints except `/health` require `X-Api-Key`, which maps to a
workspace. Every param, query and body is validated with Zod. Bad input returns **400** with
`{ error: { code, message, issues[] } }`. Unknown ids return **404**. A missing or invalid key returns **401**.
A 500 only happens for genuine bugs, and the error is logged without secrets.

## Jobs

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/jobs/ingest-images` | `{ "dir"?: "data/images" }` | **202** `{ jobId }`. Enqueues one `ingest-image` job per file. Files already ingested (same content hash) are skipped. |
| POST | `/jobs/embed-posts` | `{}` | **202** `{ jobId }`. Embeds every post that is still `pending`. |
| GET | `/jobs/:id` | | `{ state, total, done, failed, flagged, progress }` |

## Images

| Method | Path | Notes |
|---|---|---|
| GET | `/images?status=flagged&label=red_fox` | filters are validated against the enums |
| GET | `/images/:id` | tags, confidence, flag reason, attempts, cost total |

## Posts

| Method | Path | Notes |
|---|---|---|
| POST | `/posts` | `{ slug, title, body }`. Idempotent on `slug`. **201**, or **200** if it already exists. Enqueues extraction and embedding. |
| GET | `/posts/:id` | includes the extracted subject, label and category |

## Matching

`GET /posts/:id/images?limit=5`

```json
{
  "post": { "id": "...", "title": "The behavior of red foxes", "subject_label": "red_fox" },
  "result": "MATCH",
  "suggestions": [
    { "imageId": "...", "rank": 1, "similarity": 0.87, "verdict": "ACCEPTED",
      "caption": "A red fox standing in a forest",
      "reasons": [{ "code": "SUBJECT_OK", "message": "Subject matches: red fox" }] }
  ],
  "rejected": [
    { "imageId": "...", "rank": 2, "similarity": 0.81, "verdict": "REJECTED",
      "reasons": [{ "code": "SUBJECT_MISMATCH", "message": "Subject mismatch: expected red fox, detected gray wolf" }] }
  ]
}
```

If nothing passes, it returns `"result": "NO_CONFIDENT_MATCH"`, `suggestions: []`, and a `reasons` array
summarizing why the best candidates failed. **409** if the post is not embedded yet.

`POST /posts/:id/images/:imageId/check` runs the guard on one specific image (Probe 3). It returns the
same candidate shape and does not create a suggestion.

## Review

| Method | Path | Notes |
|---|---|---|
| GET | `/review?status=pending` | server-rendered HTML table (post · image thumb · similarity · reasons · actions). Returns JSON with `Accept: application/json`. |
| GET | `/suggestions/:id` | the full "why": guard reasons, thresholds used (`guard_version`), image tags, similarity, review history |
| POST | `/suggestions/:id/approve` | header `Idempotency-Key` (required), body `{ note? }` |
| POST | `/suggestions/:id/reject` | same |

Approving or rejecting an already-decided suggestion with a *different* idempotency key returns **409**.
Repeating the *same* key returns the original response.

## Ops

| Method | Path | Notes |
|---|---|---|
| GET | `/costs?kind=vision&limit=50` | raw `ai_calls` rows |
| GET | `/costs/summary` | totals by kind/model, notional vs billed, budget used / remaining |
| GET | `/health` | DB and queue reachability |
