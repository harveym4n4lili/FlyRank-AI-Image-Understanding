// Guard and flagging thresholds (docs/GUARD_AND_EVAL.md#thresholds).
// T_SIM chosen by the eval sweep over two independent tagging runs (decisions #21, #26; docs/EVAL_RESULTS.md);
// T_SIM_STRICT from decision #18;
// T_CONF calibrated to the observed confidence gap (decision #25).
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
  T_CONF: 0.8,
  T_SIM: 0.46,
  T_SIM_STRICT: 0.65,
  TOP_K: 3,
};
