// Guard and flagging thresholds (docs/GUARD_AND_EVAL.md#thresholds).
// Provisional values set from the Phase 3 demo-post run (decision #18); the Phase 4 eval sweep finalises them.
export interface GuardConfig {
  /** Below this vision confidence an image is flagged at ingestion and never auto-suggested. */
  readonly T_CONF: number;
  /** Minimum cosine similarity between post and image embeddings. */
  readonly T_SIM: number;
  /** Stricter floor used when the post's subject is unknown (subject rule can't run). */
  readonly T_SIM_STRICT: number;
  /** Maximum accepted suggestions returned per post. */
  readonly TOP_K: number;
}

export const GUARD: GuardConfig = {
  T_CONF: 0.7,
  T_SIM: 0.55,
  T_SIM_STRICT: 0.65,
  TOP_K: 3,
};
