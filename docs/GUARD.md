# Mismatch Guard

The decision core. A **pure function** with no I/O and no clock, so it is trivial to unit-test:

```ts
guard(post: PostFacts, candidate: CandidateFacts, cfg: GuardConfig): GuardResult
// GuardResult = { verdict: "ACCEPTED" | "REJECTED", reasons: Reason[] }
// Reason      = { code: string, message: string, detail?: Record<string, unknown> }
```

`matchPost()` ranks candidates, runs the guard on each one, and returns either the accepted suggestions or
`NO_CONFIDENT_MATCH` with the aggregated reasons.

## Rules (all are evaluated, and every failure is reported)

| # | Rule | Rejects when | Example message |
|---|---|---|---|
| R1 | Image is usable | `image.status != tagged` (flagged/failed) | "Image was flagged for review: low confidence (0.42)" |
| R2 | Category match | `post.category != image.category` | "Category mismatch: expected animal, detected landscape" |
| R3 | Subject match | `post.subject_label != image.subject_label` (via the taxonomy compatibility map) | "Subject mismatch: expected red fox, detected gray wolf" |
| R4 | Similarity floor | `cosine < T_SIM` | "Similarity 0.61 is below threshold 0.72" |
| R5 | Image confidence | `image.confidence < T_CONF` | "Vision confidence 0.55 is below 0.70" |

Post facts with `subject_label = unknown` skip R3 (there is nothing to compare against), and R4 then applies with
a stricter `T_SIM_STRICT`.

**Outcome for a post:**
- At least one candidate passes → ranked `ACCEPTED` suggestions (top `k`, default 3) are stored for review.
- None passes → `NO_CONFIDENT_MATCH`, with the reasons for the best-ranked candidates, e.g.
  *"Best candidate 'A brown bear in a river' (0.58): similarity below 0.72; subject mismatch: expected penguin, detected brown bear."*

**Probe 3 (forced candidate):** `POST /posts/:id/images/:imageId/check` runs the guard against one
chosen image regardless of rank, so the wolf can be checked directly against the fox post.

## Why a controlled subject label

Embedding similarity alone cannot separate a fox from a wolf reliably. Both are "wild canid in a forest",
so their captions land close together. The free-text `subject` handles synonyms for **ranking**
("Vulpes vulpes" ≈ "red fox"), while the **guard** needs a crisp yes/no. So both the vision call and the
post-extraction call must also pick a `subject_label` from the same taxonomy. The model does the hard
part (mapping "Vulpes vulpes" → `red_fox`), Zod enforces that the label is from the list, and the guard
compares labels exactly.

The taxonomy also defines compatibility. For example, a post labelled `fox` (generic) accepts `red_fox` and
`arctic_fox`, but a post labelled `red_fox` does not accept `arctic_fox`.

## Thresholds and how they get tuned

Starting values (in `src/config/guard.ts`, overridable via env):

| Name | Start | Meaning |
|---|---|---|
| `T_CONF` | 0.70 | below this, an image is flagged at ingestion and fails R5 |
| `T_SIM` | 0.70 | similarity floor |
| `T_SIM_STRICT` | 0.80 | floor when the post subject is unknown |
| `TOP_K` | 3 | max accepted suggestions per post |

These are **placeholders until Phase 4**. Tuning procedure (`npm run eval -- --sweep`):

1. Run the eval set with the guard on and sweep `T_SIM` from 0.50 to 0.90 in steps of 0.02.
2. For each value, record top-1 precision (on positive posts), abstention accuracy (on negative posts), and coverage.
3. Pick the value that gives the highest precision while still answering at least 90% of the positive posts. Prefer refusing over being wrong.
4. Commit the sweep table to `docs/EVAL_RESULTS.md` and the chosen values to config. The README cites the result.

The fox/wolf boundary is defended with numbers: the sweep table shows the cosine similarity between the
fox post and the best wolf image, and that R3 rejects it even when the similarity is high.

## Explanations are part of the contract

- Every `REJECTED` result has at least one reason. Every `ACCEPTED` result also has reasons (which checks passed, with values).
- Reasons are stored on the `suggestions` row with a `guard_version` (a hash of the thresholds), so
  `GET /suggestions/:id` can always explain a past decision, even after the thresholds change.
