# Evidence

One pasted proof per requirement in the brief's Section 6, using real command output only. A box gets ticked only
when its proof is pasted below it.

## AI processing
- [ ] Vision model produces structured output validated against a schema; invalid responses are never trusted
- [ ] Low-confidence classifications are flagged instead of accepted
- [ ] Images are processed through a batch background job with retries
- [ ] Vision and embedding costs are tracked per call

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
