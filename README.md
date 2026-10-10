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

## Demo walkthrough

The steps below run in order, from an empty database to reviewed matches. Each step says what to run and
what to point out. Allow about 15 minutes, 7 of which are the one-off image tagging in step 2.

Requirements: **Docker**, a free **Gemini API key** from https://aistudio.google.com (no credit card), and
**Node 24** (for pretty-printed output, the tests and the eval). The commands are bash; on Windows use Git Bash.

### Step 0: Start the stack

```bash
cp .env.example .env                 # set GEMINI_API_KEY and DEMO_API_KEY (any long random string)
docker compose up --build -d         # db → migrations → api (http://localhost:3000) + worker
docker compose exec -T api node dist/db/seed.js   # demo workspace + 7 demo posts
```

Then, in the shell you will demo from, load the key and four small helpers. Every endpoint except
`/health` and `/review.html` needs the `X-Api-Key` header, and ids are UUIDs. The helpers add the header and
look ids up by name, so you never paste a UUID by hand:

```bash
export DEMO_API_KEY=$(grep ^DEMO_API_KEY= .env | cut -d= -f2-)
export B=http://localhost:3000

# raw: authenticated curl. api: the same, pretty-printed.
raw() { curl -s -H "X-Api-Key: $DEMO_API_KEY" -H "Content-Type: application/json" "$@"; }
api() { raw "$@" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.stringify(JSON.parse(s),null,2))}catch{console.log(s)}})"; }
# post_id <slug> and image_id <file name without .jpg> print the UUID.
post_id()  { raw "$B/posts?limit=200"  | grep -o "\"id\":\"[^\"]*\",\"slug\":\"$1\"" | cut -d'"' -f4; }
image_id() { raw "$B/images?limit=200" | grep -o "\"id\":\"[^\"]*\",\"filePath\":\"images/$1\.jpg\"" | cut -d'"' -f4; }

api $B/health                        # {"status": "ok", "db": true}
```

### Step 1: The starting point

```bash
api $B/posts                         # 7 demo posts, all "status": "embedded"
```

> **Point out:** when a post is created, a background job asks Gemini for its subject and maps it to a fixed
> label. "Vulpes vulpes: a field guide" never says "red fox", yet its `subjectLabel` is `red_fox`. Subjects
> outside the taxonomy get `other_animal` or `unknown` (emperor penguin, sourdough).

### Step 2: Tag the image library

The 50 images are committed in `data/images/`. One call queues them all for the worker:

```bash
JOB=$(raw -X POST -d '{}' $B/jobs/ingest-images | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4); echo $JOB
api $B/jobs/$JOB                     # re-run until "state": "completed" (about 7 minutes on the free tier)
```

> **Point out while it runs:** each image goes to Gemini Flash, which must reply in a fixed JSON shape. Zod
> validates every response, and an invalid one is retried, never stored. Failed jobs back off and retry, then
> go to a dead-letter queue. Tagged images are embedded automatically.
>
> **Idempotent:** start the ingest again and it returns `"enqueued": 0, "skipped": 50`. Files are recognised
> by content hash and are never tagged twice.

### Step 3: What the AI saw

```bash
api "$B/images?label=red_fox&limit=3"   # subject, label, category, caption, confidence per image
api "$B/images?status=flagged"          # dog-09, a "wolfdog" at confidence 0.65
```

> **Point out:** the one ambiguous image is flagged instead of trusted. A flagged image is never suggested
> automatically.

### Step 4: A correct match

```bash
FOX=$(post_id red-fox-behaviour)
api "$B/posts/$FOX/images?limit=5"
```

> **Point out:** `"result": "MATCH"` with the top 3 red-fox photos. Each suggestion lists the five guard rules
> it passed (usable image, category, subject label, similarity ≥ 0.46, confidence ≥ 0.80). Every decision is
> stored with the thresholds in force at the time.

The synonym post finds the same photos without ever using the common name:

```bash
api "$B/posts/$(post_id vulpes-vulpes-field-guide)/images?limit=3"
```

### Step 5: The guard refuses a wrong match

Force the gray wolf onto the red-fox post:

```bash
api -X POST $B/posts/$FOX/images/$(image_id gray-wolf-01)/check
```

> **Point out:** `"verdict": "REJECTED"`, *"Subject mismatch: expected red fox, detected gray wolf"*. Nothing is
> stored; this endpoint only tests one pairing.

### Step 6: No confident match

Create a post live. There are no arctic foxes in the library:

```bash
api -X POST $B/posts -d '{"slug":"arctic-fox-in-winter","title":"The arctic fox in winter","body":"Vulpes lagopus turns pure white in winter and survives the tundra by hunting lemmings under the snow."}'
ARCTIC=$(post_id arctic-fox-in-winter)
api $B/posts/$ARCTIC                 # "status": "pending" → "embedded" within a few seconds
api "$B/posts/$ARCTIC/images?limit=3"
```

> **Point out:** `"result": "NO_CONFIDENT_MATCH"`. The red foxes are the closest images (similarity about
> 0.6, well above the threshold), but the subject rule refuses them, and `reasons` says why for each one.
> Ranking by similarity alone would have suggested a red fox here.

A post outside the library entirely is refused on category, with the stricter 0.65 floor that applies when the
subject is unknown:

```bash
api "$B/posts/$(post_id sourdough-starter-basics)/images?limit=3"   # "Category mismatch: expected food, detected animal"
```

### Step 7: Human review

Open **http://localhost:3000/review.html**, paste the API key, and approve or reject the pending suggestions
with the photos in view. The same works through the API:

```bash
SID=$(raw "$B/review?verdict=ACCEPTED&limit=1" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
api $B/suggestions/$SID                                                # the "why": rules, similarity, thresholds
api -X POST -H "Idempotency-Key: demo-approve-0001" $B/suggestions/$SID/approve   # "replayed": false
api -X POST -H "Idempotency-Key: demo-approve-0001" $B/suggestions/$SID/approve   # same key → "replayed": true
api -X POST -H "Idempotency-Key: demo-approve-0002" $B/suggestions/$SID/approve   # new key → 409 ALREADY_DECIDED
```

A pairing the guard rejected cannot be approved:

```bash
REJ=$(raw "$B/posts/$ARCTIC/images?limit=3" | grep -o '"suggestionId":"[^"]*"' | head -1 | cut -d'"' -f4)
api -X POST -H "Idempotency-Key: demo-approve-0003" $B/suggestions/$REJ/approve  # 409 GUARD_REJECTED
```

When you repeat the demo, use new Idempotency-Keys, because a key that was already used replays its first response.

### Step 8: Cost tracking

```bash
api $B/costs/summary
```

> **Point out:** every model call is logged with its tokens, notional cost and outcome. The whole demo costs
> about $0.04 at list prices and $0 on the free tier. A daily budget (`maxUsd`, `maxCalls`) is checked before
> each call.

### Step 9: Evaluation and tests

Run these on the host, with the stack running and the corpus tagged:

```bash
npm install
npm run eval              # top-1 precision on the 16 labeled posts in eval/posts.json
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
