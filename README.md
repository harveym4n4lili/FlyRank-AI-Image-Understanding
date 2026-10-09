# AI Image Understanding & Content Matching Engine

Looks at an image library, understands what is in each image, and matches the right image to each blog
post, with a **mismatch guard** that refuses wrong matches and explains why. A red-fox post gets the
red-fox photo, never the wolf. When nothing is good enough, the answer is "no confident match".

> **Status:** Phases 0–2 done: the image pipeline tags all 50 images (49 tagged, 1 low-confidence flagged) with per-call cost tracking. Phase 3 (matching + guard) is next. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Architecture

```
Images —(batch job)→ Gemini Flash → {tags, caption, confidence} → images (+ Zod validation, flagging)
                      └ embed(caption) ───────────────→ image_embeddings (pgvector)

Posts ────────────────→ embed(post text) ──────────────→ post_embeddings (pgvector)

GET /posts/:id/images
  → cosine ranking (image_embeddings × post_embedding)
  → mismatch guard (subject label + category + similarity threshold + confidence)
      ├ ranked, explained suggestions
      └ "no confident match" + reasons
  → review API: approve / reject / inspect why
```

Two processes share one codebase: **api** (Express) and **worker** (pg-boss jobs). Both use PostgreSQL 16 +
pgvector. **First-time setup: [docs/SETUP.md](docs/SETUP.md).** Design docs: [DESIGN.md](docs/DESIGN.md) · [SPEC.md](docs/SPEC.md) ·
[GUARD_AND_EVAL.md](docs/GUARD_AND_EVAL.md) · [ROADMAP.md](docs/ROADMAP.md).

## Run it

Requirements: Docker. Node 24 is only needed for local development.

```bash
cp .env.example .env          # add a free Gemini AI Studio key (no credit card)
docker compose up --build     # db + api (http://localhost:3000) + worker
curl http://localhost:3000/health
```

Seed the demo workspace (its API key is `DEMO_API_KEY` from `.env`), then tag the corpus:

```bash
docker compose exec -T api node dist/db/seed.js
curl -X POST -H "X-Api-Key: $DEMO_API_KEY" -H "Content-Type: application/json" -d '{}' http://localhost:3000/jobs/ingest-images
curl -H "X-Api-Key: $DEMO_API_KEY" http://localhost:3000/jobs/<jobId>      # progress
curl -H "X-Api-Key: $DEMO_API_KEY" "http://localhost:3000/images?status=flagged"
curl -H "X-Api-Key: $DEMO_API_KEY" http://localhost:3000/costs/summary
```

### Local development

```bash
npm install
docker compose up -d db       # just Postgres
npm run dev:api               # and in another terminal: npm run dev:worker
npm test                      # unit tests
npm run lint && npm run typecheck
```

## Results

Top-1 precision on the labeled eval set: *measured in Phase 4.*

## Limitations

*To be written honestly as the system takes shape.*

## License

[MIT](LICENSE)
