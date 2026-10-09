# Mismatch Guard, Corpus & Evaluation

## The guard

The decision core. A **pure function** with no I/O and no clock, so it is trivial to unit-test:

```ts
guard(post: PostFacts, candidate: CandidateFacts, cfg: GuardConfig): GuardResult
// GuardResult = { verdict: "ACCEPTED" | "REJECTED", reasons: Reason[] }
// Reason      = { code: string, message: string, detail?: Record<string, unknown> }
```

`matchPost()` ranks candidates, runs the guard on each one, and returns either the accepted suggestions or
`NO_CONFIDENT_MATCH` with the aggregated reasons.

### Rules (all are evaluated, and every failure is reported)

| # | Rule | Rejects when | Example message |
|---|---|---|---|
| R1 | Image is usable | `image.status != tagged` | "Image was flagged for review: low confidence (0.42)" |
| R2 | Category match | `post.category != image.category` | "Category mismatch: expected animal, detected landscape" |
| R3 | Subject match | labels not compatible per the taxonomy | "Subject mismatch: expected red fox, detected gray wolf" |
| R4 | Similarity floor | `cosine < T_SIM` | "Similarity 0.61 is below threshold 0.72" |
| R5 | Image confidence | `image.confidence < T_CONF` | "Vision confidence 0.55 is below 0.70" |

If the post's `subject_label = unknown`, R3 is skipped and R4 uses the stricter `T_SIM_STRICT`.

**Per-post outcome:**
- At least one candidate passes → the top `k` (default 3) `ACCEPTED` suggestions are stored for review.
- Nothing passes → `NO_CONFIDENT_MATCH` with the reasons for the best candidates, e.g.
  *"Best candidate 'A brown bear in a river' (0.58): similarity below 0.72; subject mismatch: expected penguin, detected brown bear."*

Explanations are part of the contract. Every verdict, including `ACCEPTED`, carries reasons with their values,
and they are stored with a `guard_version` so a past decision can always be explained.

### Why a controlled subject label

Embedding similarity alone cannot separate a fox from a wolf reliably. Both are "wild canid in a forest",
so their captions land close together. The free-text `subject` handles synonyms for **ranking**
("Vulpes vulpes" ≈ "red fox"), while the **guard** needs a crisp yes/no. So both the vision call and the
post-extraction call must also pick a `subject_label` from the same taxonomy. The model does the hard
part (mapping "Vulpes vulpes" → `red_fox`), Zod enforces that the label is from the list, and the guard
compares labels. The taxonomy also defines compatibility: a generic `fox` post accepts `red_fox` and
`arctic_fox`, but a `red_fox` post does not accept `arctic_fox`.

### Thresholds

| Name | Start | Meaning |
|---|---|---|
| `T_CONF` | 0.70 | below this, an image is flagged at ingestion and fails R5 |
| `T_SIM` | 0.70 | similarity floor |
| `T_SIM_STRICT` | 0.80 | floor when the post subject is unknown |
| `TOP_K` | 3 | max accepted suggestions per post |

These are placeholders until Phase 4. Tuning (`npm run eval -- --sweep`):
1. Sweep `T_SIM` from 0.50 to 0.90 in steps of 0.02 over the eval set.
2. For each value, record top-1 precision, abstention accuracy and coverage.
3. Pick the value with the highest precision that still answers at least 90% of positive posts. Prefer refusing over being wrong.
4. Commit the sweep table to `docs/EVAL_RESULTS.md` and the chosen values to config. The README cites the result.

The fox/wolf boundary is defended with numbers: the sweep table shows how similar the fox post is to the best
wolf image, and that R3 still rejects it.

## Image corpus

**50 images, 5 categories × 10**, from Unsplash and Pexels only (free licenses; attribution recorded anyway).

| Category | Count | Deliberate hard cases |
|---|---|---|
| Red fox | 10 | a fox far away in snow (low-confidence candidate), a fox cub |
| Gray wolf | 10 | 2 wolves in forest settings similar to the fox shots (the near-miss) |
| Dog | 10 | 2 husky / wolf-like breeds, a red shiba (orange fur, like a fox) |
| Bear | 10 | brown and black bears |
| Deer | 10 | a silhouette at dusk (low-confidence candidate) |

The hard cases make Probe 1 (at least one image flagged) and Probe 2 (wolf and dog rank clearly lower) real tests rather than staged ones.

**Storage:** `data/manifest.json` lists `{ id, file, source_url, download_url, photographer, license, category_expected }`.
`npm run corpus:download` fetches the images, resizes them to ≤ 800px JPEG with `sharp`, and writes them to `data/images/`.
If the total stays under ~5 MB, the images are committed so evaluators can reproduce the results offline.
`category_expected` is used only for evaluation and is never sent to the model or the guard.

**Calibration:** self-reported model confidence is poorly calibrated, so an image is also flagged when
`subject_label = unknown` or `category = other`. In Phase 2 the flagged images get checked by eye, and that check is logged in BUILDLOG.md.

## Eval set

`eval/posts.json`: at least 15 labeled posts of about 80–150 words each.

| Type | Count | Label | Purpose |
|---|---|---|---|
| Positive, plain wording | 5 (one per category) | `expected_image_ids` | basic retrieval |
| Positive, synonym wording | 5 | e.g. "Vulpes vulpes", "Canis lupus", "cervids" | concept matching, not keyword matching |
| Negative | 3 | `expected: "NO_CONFIDENT_MATCH"` | penguins, sourdough, skylines (Probe 4) |
| Near-miss | 2 | e.g. arctic fox post (only red foxes exist), sled dogs vs wolves | stresses R3 |

Positive posts list **all** acceptable images, because several fox photos are correct for a fox post. This is a
stricter and more honest version of the brief's "mark the one correct image".

### Metrics (`npm run eval`)

- **Top-1 precision** (headline): the share of positive posts whose top `ACCEPTED` suggestion is in `expected_image_ids`. An abstention counts as not correct.
- **Abstention accuracy:** the share of negative posts that get `NO_CONFIDENT_MATCH`.
- **Wrong-accept count:** the number of incorrect images ACCEPTED. The target is 0.
- **Coverage:** the share of positive posts that get any accepted suggestion.

The script prints a per-post table and the summary, and writes `eval/results/<timestamp>.json`. The README quotes the committed run (Probe 5).
