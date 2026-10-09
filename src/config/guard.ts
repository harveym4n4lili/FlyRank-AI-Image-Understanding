// Guard and flagging thresholds (docs/GUARD_AND_EVAL.md#thresholds).
// Starting values; tuned against the eval set in Phase 4.
export const GUARD = {
  /** Below this vision confidence an image is flagged at ingestion and never auto-suggested. */
  T_CONF: 0.7,
  T_SIM: 0.7,
  T_SIM_STRICT: 0.8,
  TOP_K: 3,
} as const;
