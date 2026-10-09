# Corpus & Evaluation Plan

## Image corpus

**50 images, 5 categories × 10**, sourced only from Unsplash and Pexels (both free to use; attribution is
recorded anyway).

| Category | Count | Deliberate hard cases |
|---|---|---|
| Red fox | 10 | 1 fox far away in snow (low-confidence candidate), 1 fox cub |
| Gray wolf | 10 | 2 wolves in forest settings similar to the fox shots (the near-miss) |
| Dog | 10 | 2 husky / wolf-like breeds, 1 red shiba (orange fur, like a fox) |
| Bear | 10 | brown and black bears |
| Deer | 10 | 1 silhouette at dusk (low-confidence candidate) |

These hard cases exist so that Probe 1 ("at least one image flagged") and Probe 2 ("wolf and dog rank clearly
lower") are real tests rather than staged ones.

**Storage:** `data/manifest.json` lists `{ id, file, source_url, download_url, photographer, license, category_expected }`.
`npm run corpus:download` fetches the images, resizes them to ≤ 800px JPEG with `sharp`, and writes them to `data/images/`.
If the resized total stays under ~5 MB the images are committed, so evaluators can reproduce results without
network flakiness. Otherwise only the manifest and the script are committed.

`category_expected` is **only** for evaluation and auditing. It is never sent to the model and never used by the guard.

## Eval set

`eval/posts.json`: at least 15 labeled posts, written by me. Each post is about 80–150 words, so embeddings see real prose.

| Type | Count | Label | Purpose |
|---|---|---|---|
| Positive, plain wording | 5 (one per category) | `expected_image_ids: [...]` | basic retrieval |
| Positive, synonym wording | 5 | e.g. "Vulpes vulpes", "Canis lupus", "cervids" | proves concept matching, not keyword matching |
| Negative (no suitable image) | 3 | `expected: "NO_CONFIDENT_MATCH"` | e.g. penguins, sourdough baking, city skylines; exercises Probe 4 |
| Near-miss | 2 | e.g. arctic fox post (only red foxes exist), sled dogs vs wolves | stresses R3 |

Each positive post lists **all** acceptable images (several fox photos are all correct for a fox post), and
top-1 counts as correct if the first accepted image is in that set. The brief says "mark the one correct image";
a set is a stricter and more honest version of that, and it is documented here.

## Metrics (`npm run eval`)

- **Top-1 precision** (headline): the share of positive posts where the top `ACCEPTED` suggestion is in `expected_image_ids`.
  A post that gets `NO_CONFIDENT_MATCH` counts as **not correct** in this number (reported as an abstention).
- **Abstention accuracy:** the share of negative posts that correctly get `NO_CONFIDENT_MATCH`.
- **Wrong-accept count:** the number of times an incorrect image was ACCEPTED. The target is 0.
- **Coverage:** the share of positive posts that receive any accepted suggestion.

The script prints a per-post table and the summary, and writes `eval/results/<timestamp>.json`. The README
quotes the exact number from the committed run (Probe 5).

## Low-confidence calibration note

Self-reported model confidence is poorly calibrated. Besides `T_CONF`, an image is also flagged when
`subject_label = unknown` or the model returns `category = other`. During Phase 2, the flagged images get
checked by eye, and that check is logged in BUILDLOG.md.
