# Eval Results

How the matching engine was measured and how its thresholds were chosen. Reproduce with
`npm run eval -- --sweep` (the reference run is saved in `eval/results/latest.json`).

## Setup

- **Eval set** (`eval/posts.json`): 16 hand-written posts. 11 have correct images (6 plain, 5 that only use a
  synonym or scientific name) and 5 have none (penguin, sourdough, city skyline, plus two near misses: an arctic
  fox, with only red foxes in the library, and coyotes, which aren't in the taxonomy).
- **Ground truth**: a positive post lists its acceptable labels; an image counts as correct when its *hand-labeled*
  `expected_label` in `data/manifest.json` is in that list. The model's own labels are never used for scoring.
- **Method**: each post is ranked against all 50 image embeddings (top 10 candidates) and the pure guard is
  applied. The sweep re-runs only the guard with different thresholds on the same similarities (no extra AI calls).
- **Two independent runs**: the *reference* run (the development database) and a *fresh-clone* run, where the
  committed files were started on an empty database, so all 50 images and 16 posts were tagged and embedded again
  from scratch. Vision captions differ slightly between runs, so similarities do too.

## Final result (guard `ad16f81fc90b`: T_SIM 0.46, T_SIM_STRICT 0.65, T_CONF 0.80, TOP_K 3)

| Metric | Reference run | Fresh-clone run |
|---|---|---|
| **Top-1 precision** (abstaining counts as a miss) | **100% (11/11)** | **100% (11/11)** |
| Precision when answered | 100% | 100% |
| Coverage (positives that got a suggestion) | 100% | 100% |
| Abstention accuracy (negatives refused) | 100% (5/5) | 100% (5/5) |
| Wrong accepts (any accepted image with the wrong label) | 0 | 0 |
| Baseline: most similar image, no guard | 72.7% | 81.8% |

Reference run, per post:

| post | type | post label | result | top-1 image | correct |
|---|---|---|---|---|---|
| red-fox-behaviour | positive | red_fox | MATCH | red-fox-09.jpg | ✓ |
| how-wolf-packs-hunt | positive | gray_wolf | MATCH | gray-wolf-03.jpg | ✓ |
| choosing-a-family-dog | positive | dog | MATCH | dog-04.jpg | ✓ |
| bears-of-north-america | positive | bear | MATCH | black-bear-01.jpg | ✓ |
| white-tailed-deer-backyard | positive | white_tailed_deer | MATCH | white-tailed-deer-02.jpg | ✓ |
| red-deer-rut | positive | red_deer | MATCH | red-deer-03.jpg | ✓ |
| vulpes-vulpes-field-guide | synonym | red_fox | MATCH | red-fox-09.jpg | ✓ |
| canis-lupus-return | synonym | gray_wolf | MATCH | gray-wolf-03.jpg | ✓ |
| ursus-arctos-horribilis | synonym | brown_bear | MATCH | brown-bear-04.jpg | ✓ |
| cervus-elaphus-highlands | synonym | red_deer | MATCH | red-deer-03.jpg | ✓ |
| canis-familiaris-companion | synonym | dog | MATCH | dog-04.jpg | ✓ |
| emperor-penguin-winter | negative | other_animal | NO_CONFIDENT_MATCH | — | ✓ |
| sourdough-starter-basics | negative | unknown | NO_CONFIDENT_MATCH | — | ✓ |
| city-skyline-at-night | negative | unknown | NO_CONFIDENT_MATCH | — | ✓ |
| arctic-fox-camouflage | near_miss | arctic_fox | NO_CONFIDENT_MATCH | — | ✓ |
| coyotes-in-the-suburbs | near_miss | other_animal | NO_CONFIDENT_MATCH | — | ✓ |

### What the guard adds

In the reference run the guard fixed three posts where the most similar image was the wrong animal: both dog posts
and `ursus-arctos-horribilis` had a **black bear** ranked first. (In the fresh run it was a gray wolf for one dog post.)
The subject rule refused it and the next correct image was suggested. Without the guard, every one of the 5
unanswerable posts would also have received an image.

## Threshold sweep (T_SIM; T_SIM_STRICT 0.65 and T_CONF 0.80 fixed)

| T_SIM | top-1, reference | top-1, fresh clone | abstention (ref / fresh) | wrong accepts (ref / fresh) |
|---|---|---|---|---|
| 0.40 | 100.0% | 100.0% | 100% / 100% | 0 / 0 |
| 0.42 | 100.0% | 100.0% | 100% / 100% | 0 / 0 |
| 0.44 | 100.0% | 100.0% | 100% / 100% | 0 / 0 |
| **0.46 ← chosen** | **100.0%** | **100.0%** | **100% / 100%** | **0 / 0** |
| 0.48 | 100.0% | 90.9% | 100% / 100% | 0 / 0 |
| 0.50 | 81.8% | 81.8% | 100% / 100% | 0 / 0 |
| 0.52 | 81.8% | 81.8% | 100% / 100% | 0 / 0 |
| 0.54 | 81.8% | 81.8% | 100% / 100% | 0 / 0 |
| 0.56 | 81.8% | 81.8% | 100% / 100% | 0 / 0 |
| 0.58 | 72.7% | 81.8% | 100% / 100% | 0 / 0 |
| 0.60 | 72.7% | 72.7% | 100% / 100% | 0 / 0 |
| 0.62 | 54.5% | 63.6% | 100% / 100% | 0 / 0 |
| 0.64 | 54.5% | 54.5% | 100% / 100% | 0 / 0 |
| 0.66 | 36.4% | 27.3% | 100% / 100% | 0 / 0 |
| 0.68 | 27.3% | 27.3% | 100% / 100% | 0 / 0 |
| 0.70 | 9.1% | 0.0% | 100% / 100% | 0 / 0 |
| 0.72 – 0.80 | 0.0% | 0.0% | 100% / 100% | 0 / 0 |

**Choice rule** (written in GUARD_AND_EVAL.md before the sweep): highest top-1 precision with zero wrong accepts;
among ties prefer the **higher** threshold (refusing beats being wrong).

- On the reference run alone the rule gave **0.48** (decision #21).
- The fresh-clone run then scored **90.9%** at 0.48: the generic dog post's best dog came out at 0.474 after
  re-tagging, so it abstained (a safe failure; nothing wrong was suggested).
- Applying the same rule to both runs gives **0.46**, the highest value that is 100% on both (decision #26).

**No threshold produced a wrong accept** in either run. Wrong animals are stopped by the subject and category rules,
not by similarity; the similarity floor only decides how many correct-but-weakly-similar matches are offered.

## The fox/wolf boundary

On `red-fox-behaviour` (reference run), the best fox scores **0.665**; the best wolf is **#13 at 0.50** and the best
dog **#15 at 0.48**, both outside the top 10 candidates. The most fox-like wolf (`gray-wolf-05`, a forest scene) forced
onto the post is refused in both runs: *"Subject mismatch: expected red fox, detected gray wolf"*. The arctic-fox post
shows why the subject rule matters even when similarity is high: the snowy red fox scores **0.61** (above `T_SIM`) and
is still refused, *"expected arctic fox, detected red fox"*.

## Reproducibility and caveats

- **Re-tagging changes the details.** With temperature 0, the same image still got different captions and confidences
  on different runs (`dog-09`: 0.65, then 0.75, then 0.68). Top-1 picks can change (e.g. `dog-04` vs `dog-10`); the
  headline number held at 100% on both runs at T_SIM 0.46, but a third run could differ. The reference numbers are
  the ones in `eval/results/latest.json`.
- **Dog margin is thin.** For generic dog posts the embedding barely separates dogs from bears and wolves; the
  accepted dog scored 0.474–0.497 against `T_SIM` 0.46 across runs. The subject rule is doing the work there.
- **Small, single-annotator set**: 16 posts and 50 images labeled by one person; the threshold is tuned on the same
  posts it is reported on.
- **T_CONF 0.80** sits in the gap between the ambiguous `dog-09` (0.65–0.75) and the clearest images (≥ 0.85 across
  runs); it doesn't change any eval metric (decision #25).
- Possible improvement not tried yet: asymmetric embedding task types (`RETRIEVAL_QUERY` for posts,
  `RETRIEVAL_DOCUMENT` for captions), which may widen the similarity gaps (decision #10).
