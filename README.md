# AI Image Understanding & Content Matching Engine

Looks at an image library, understands what is in each image, and matches the right image to each blog
post, with a **mismatch guard** that refuses wrong matches and explains why. A red-fox post gets the
red-fox photo, never the wolf. When nothing is good enough, the answer is "no confident match".

**Result:** on a hand-labeled eval set of 16 posts, **top-1 precision is 100% (11/11)**, with every one of
the 5 posts that have no correct image correctly refused and **0 wrong suggestions**. The same result held on an
independent fresh-clone run that re-tagged everything from scratch. Ranking by similarity alone, without the guard,
gets 72.7–81.8% and suggests an image for every unanswerable post. Details: [docs/EVAL_RESULTS.md](docs/EVAL_RESULTS.md).

## What it does

1. **Understands images.** A background job sends each image to Gemini Flash, which must answer in a fixed
   JSON shape (subject, label, category, attributes, caption, confidence). Every response is validated with Zod;
   invalid output is retried, never stored. Low-confidence or unidentifiable images are **flagged** for review.
2. **Understands posts.** Each post's subject is extracted (e.g. "Vulpes vulpes" → `red_fox`) with the same
   validation, and both images and posts are embedded into one vector space (pgvector).
3. **Matches by meaning.** For a post, images are ranked by cosine similarity, then every candidate goes through
   the **mismatch guard**: image usable · category matches · subject label compatible · similarity above a tuned
   threshold · vision confidence. Each failed rule becomes a readable reason
   ("Subject mismatch: expected red fox, detected gray wolf").
4. **Keeps a human in the loop.** Suggestions can be approved or rejected (idempotently), and any decision can be
   inspected to see why it was made, including the exact thresholds that were in force.
5. **Tracks every AI call.** Tokens, notional cost, outcome and attribution for each call, plus a daily budget guard.

## Architecture

```
                     ┌──────────── worker (pg-boss jobs: retries · backoff · dead-letter + alert) ───────────┐
Images ─ ingest job ─┤→ Gemini Flash → Zod-validated tags → images (+ flag if low confidence)                 │
                     │       └→ embed(subject + caption + attributes) ──→ image_embeddings  (pgvector, HNSW)  │
Posts ── POST /posts ┤→ Gemini Flash → Zod-validated subject → posts                                          │
                     │       └→ embed(title + body) ───────────────────→ post_embeddings   (pgvector, HNSW)   │
                     └──── every model call → ai_calls (tokens, cost, outcome) · budget guard before each ────┘

api:  GET /posts/:id/images
        → cosine ranking (top N image_embeddings for the post vector)
        → mismatch guard (pure function)  R1 usable · R2 category · R3 subject label · R4 similarity · R5 confidence
            ├─ MATCH: top-3 accepted suggestions, each with reasons
            └─ NO_CONFIDENT_MATCH: reasons for the best candidates
        → suggestions table (every decision + thresholds used)
      POST /suggestions/:id/approve|reject  (Idempotency-Key)  ·  GET /suggestions/:id (why)  ·  /review.html
```

Layers: `routes/` (HTTP + Zod validation) → `services/` (logic; the guard is a pure function in `domain/`) →
`repositories/` (Drizzle) and `providers/` (Gemini). One codebase runs as two processes, **api** (Express 5) and
**worker** (pg-boss), on PostgreSQL 16 + pgvector. Design: [DESIGN.md](docs/DESIGN.md) ·
[SPEC.md](docs/SPEC.md) · [GUARD_AND_EVAL.md](docs/GUARD_AND_EVAL.md). Setup checklist: [SETUP.md](docs/SETUP.md).
Per-phase checks: [TESTING.md](docs/TESTING.md).

## Run it

Requirements: **Docker**, and a free **Gemini API key** from https://aistudio.google.com (no credit card).
Node 24 is only needed for the tests and the eval script.

```bash
cp .env.example .env                 # set GEMINI_API_KEY and DEMO_API_KEY (any long random string)
docker compose up --build -d         # db → migrations → api (http://localhost:3000) + worker
docker compose exec -T api node dist/db/seed.js   # demo workspace + 7 demo posts

export DEMO_API_KEY=$(grep ^DEMO_API_KEY= .env | cut -d= -f2-)
export B=http://localhost:3000
curl $B/health
```

Tag the 50-image corpus (committed in `data/images/`; about 7 minutes on the free tier). Tagged images are embedded
automatically:

```bash
curl -X POST -H "X-Api-Key: $DEMO_API_KEY" -H "Content-Type: application/json" -d '{}' $B/jobs/ingest-images
curl -H "X-Api-Key: $DEMO_API_KEY" $B/jobs/<jobId>                    # progress → "state":"completed"
curl -H "X-Api-Key: $DEMO_API_KEY" "$B/images?status=flagged"          # low-confidence images
curl -H "X-Api-Key: $DEMO_API_KEY" $B/costs/summary                   # every AI call, costed
```

Match images to posts:

```bash
curl -H "X-Api-Key: $DEMO_API_KEY" $B/posts                                       # post ids
curl -H "X-Api-Key: $DEMO_API_KEY" "$B/posts/<postId>/images?limit=5"            # ranked + guarded
curl -X POST -H "X-Api-Key: $DEMO_API_KEY" $B/posts/<postId>/images/<imageId>/check   # force one candidate
```

Review: open **http://localhost:3000/review.html**, paste the API key, then approve or reject. Or use the API:

```bash
curl -H "X-Api-Key: $DEMO_API_KEY" "$B/review?verdict=ACCEPTED"
curl -X POST -H "X-Api-Key: $DEMO_API_KEY" -H "Idempotency-Key: my-key-0001" $B/suggestions/<id>/approve
curl -H "X-Api-Key: $DEMO_API_KEY" $B/suggestions/<id>                # why it was suggested or refused
```

Evaluate (on the host, with the stack running and the corpus tagged):

```bash
npm install
npm run eval              # top-1 precision on eval/posts.json
npm run eval -- --sweep   # plus the T_SIM threshold sweep
npm test                  # 90 unit tests
```

## Results

From `npm run eval` (thresholds `T_SIM` 0.46, `T_SIM_STRICT` 0.65, `T_CONF` 0.80, guard `ad16f81fc90b`; reference
run saved in `eval/results/latest.json`):

| Metric | With the guard | Ranking only |
|---|---|---|
| **Top-1 precision** (11 posts that have a correct image) | **100% (11/11)** | 72.7% (8/11) |
| Same, on an independent fresh-clone run | **100% (11/11)** | 81.8% (9/11) |
| Posts without a correct image refused (5) | **100% (5/5)** | 0% |
| Wrong suggestions | **0** | — |

- Synonym posts that never use the common name ("Vulpes vulpes", "Canis lupus", "Cervus elaphus", …) all match.
- The forced wolf on the red-fox post is refused: *"Subject mismatch: expected red fox, detected gray wolf"*.
- An arctic-fox post (no arctic foxes in the library) refuses the red fox even at similarity 0.61.
- Image tagging: 50/50 schema-valid, 49/50 labels agree with the hand-labeled manifest, 1 image flagged
  (`dog-09`, "wolfdog", confidence 0.65). Total notional AI cost for the whole build ≈ $0.04, billed $0.

## Limitations

- **Small, single-annotator eval.** 16 posts and 50 images, written and labeled by me. 100% here means "no errors
  on this set", not a guarantee; the threshold was chosen on the same set it is reported on.
- **Runs are not identical.** Re-tagging gives slightly different captions and confidences even at temperature 0.
  The 100% held on two independent runs, but the exact top-1 picks changed and a third run could differ.
- **Thin margin for dogs.** For the dog posts the embedding ranks a black bear or a wolf *above* every dog; the guard's
  subject rule fixes it, and the accepted dog scored 0.474–0.497 against `T_SIM` 0.46. At 0.48 one fresh run abstained.
- **The guard trusts the vision labels.** If the model mislabels an image confidently, the subject rule believes it.
  Flagging low confidence reduces this, but self-reported confidence is poorly calibrated: clear images score 0.88–0.99,
  and the same ambiguous image (`dog-09`) scored 0.65 on one run and 0.75 on another, so `T_CONF` sits in the gap at 0.80.
- **Fixed taxonomy.** Subjects outside the label list become `other_animal`/`unknown` and can never be matched by
  label; supporting a new animal means adding a label.
- **Costs are notional.** Prices in `src/config/pricing.ts` are assumptions for the budget guard; the free tier bills $0.
- **Single demo tenant.** Workspaces isolate data by API key, but there is no user management.

## Repository guide

| Path | What |
|---|---|
| `src/` | API, worker, guard (`src/domain/guard.ts`), services, repositories, Gemini providers |
| `drizzle/` | SQL migrations (schema history) |
| `data/` | 50 images, `manifest.json` (sources + ground-truth labels), demo posts |
| `eval/` | labeled eval set and saved results (`eval/results/latest.json`) |
| `scripts/` | corpus download, eval |
| `EVIDENCE.md` · `BUILDLOG.md` | proof per requirement · honest AI-usage log |

## License

[MIT](LICENSE)
