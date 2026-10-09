// The mismatch guard (docs/GUARD_AND_EVAL.md). Pure: no I/O, no clock — the same inputs always
// give the same verdict and the same explanation.
import { createHash } from "node:crypto";
import { GUARD, type GuardConfig } from "../config/guard.js";
import { LABEL_NAMES, labelsCompatible, SUBJECT_LABELS, type SubjectLabel } from "../config/taxonomy.js";


export interface Reason {
  code: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface PostFacts {
  subject: string;
  subjectLabel: SubjectLabel;
  category: string;
}

export interface CandidateFacts {
  imageId: string;
  status: string;
  subject: string | null;
  subjectLabel: string | null;
  category: string | null;
  confidence: number | null;
  caption: string | null;
  similarity: number;
}

export type Verdict = "ACCEPTED" | "REJECTED";

export interface GuardResult {
  verdict: Verdict;
  reasons: Reason[];
}

function isLabel(value: string | null): value is SubjectLabel {
  return value !== null && (SUBJECT_LABELS as readonly string[]).includes(value);
}

function describe(label: string | null, freeText: string | null): string {
  if (label === "other_animal" || label === "unknown" || !isLabel(label)) return freeText ?? label ?? "unknown subject";
  return LABEL_NAMES[label];
}

const fmt = (n: number) => n.toFixed(2);

export function guard(post: PostFacts, c: CandidateFacts, cfg: GuardConfig = GUARD): GuardResult {
  const failures: Reason[] = [];
  const passes: Reason[] = [];

  // R1 — only images that were confidently tagged can be suggested.
  if (c.status === "tagged") {
    passes.push({ code: "IMAGE_OK", message: "Image was confidently tagged" });
  } else if (c.status === "flagged") {
    failures.push({
      code: "IMAGE_FLAGGED",
      message: `Image was flagged for review at ingestion (confidence ${fmt(c.confidence ?? 0)})`,
    });
  } else {
    failures.push({ code: "IMAGE_NOT_READY", message: `Image is not usable yet (status: ${c.status})` });
  }

  // R2 — the broad category must agree.
  if (c.category === post.category) {
    passes.push({ code: "CATEGORY_OK", message: `Category matches: ${post.category}` });
  } else {
    failures.push({
      code: "CATEGORY_MISMATCH",
      message: `Category mismatch: expected ${post.category}, detected ${c.category ?? "unknown"}`,
    });
  }

  // R3 — the subject labels must be compatible. Skipped only when the post's subject is unknown.
  const strict = post.subjectLabel === "unknown";
  if (strict) {
    passes.push({
      code: "SUBJECT_UNCHECKED",
      message: "Post subject is unclear, so the stricter similarity threshold applies instead",
    });
  } else if (isLabel(c.subjectLabel) && labelsCompatible(post.subjectLabel, c.subjectLabel)) {
    passes.push({ code: "SUBJECT_OK", message: `Subject matches: ${describe(c.subjectLabel, c.subject)}` });
  } else {
    const expected = describe(post.subjectLabel, post.subject);
    const detected = describe(c.subjectLabel, c.subject);
    failures.push({
      code: "SUBJECT_MISMATCH",
      message: `Subject mismatch: expected ${expected}, detected ${detected}`,
      detail: { expected: post.subjectLabel, detected: c.subjectLabel },
    });
  }

  // R4 — semantic similarity must clear the floor.
  const threshold = strict ? cfg.T_SIM_STRICT : cfg.T_SIM;
  if (c.similarity >= threshold) {
    passes.push({ code: "SIMILARITY_OK", message: `Similarity ${fmt(c.similarity)} meets threshold ${fmt(threshold)}` });
  } else {
    failures.push({
      code: "SIMILARITY_LOW",
      message: `Similarity ${fmt(c.similarity)} is below threshold ${fmt(threshold)}`,
      detail: { similarity: c.similarity, threshold },
    });
  }

  // R5 — the image's own tagging confidence.
  if ((c.confidence ?? 0) >= cfg.T_CONF) {
    passes.push({ code: "CONFIDENCE_OK", message: `Vision confidence ${fmt(c.confidence ?? 0)} meets ${fmt(cfg.T_CONF)}` });
  } else {
    failures.push({
      code: "CONFIDENCE_LOW",
      message: `Vision confidence ${fmt(c.confidence ?? 0)} is below ${fmt(cfg.T_CONF)}`,
    });
  }

  return failures.length ? { verdict: "REJECTED", reasons: failures } : { verdict: "ACCEPTED", reasons: passes };
}

export interface EvaluatedCandidate extends CandidateFacts, GuardResult {
  rank: number;
}

export interface MatchOutcome {
  result: "MATCH" | "NO_CONFIDENT_MATCH";
  accepted: EvaluatedCandidate[];
  rejected: EvaluatedCandidate[];
  /** Candidates that passed the guard but were cut by TOP_K. */
  extraPassed: number;
  reasons: string[];
}

// Runs the guard over candidates already ranked by similarity (best first).
export function matchPost(post: PostFacts, ranked: CandidateFacts[], cfg: GuardConfig = GUARD): MatchOutcome {
  const evaluated = ranked.map((c, i) => ({ ...c, rank: i + 1, ...guard(post, c, cfg) }));
  const passed = evaluated.filter((e) => e.verdict === "ACCEPTED");
  const accepted = passed.slice(0, cfg.TOP_K);
  const extraPassed = passed.length - accepted.length;
  const rejected = evaluated.filter((e) => e.verdict === "REJECTED");

  if (accepted.length > 0) return { result: "MATCH", accepted, rejected, extraPassed, reasons: [] };

  const reasons =
    evaluated.length === 0
      ? ["No embedded images are available to compare against"]
      : evaluated
          .slice(0, 3)
          .map(
            (e) =>
              `Best candidate #${e.rank} "${e.caption ?? e.imageId}" (similarity ${fmt(e.similarity)}): ` +
              e.reasons.map((r) => r.message).join("; "),
          );
  return { result: "NO_CONFIDENT_MATCH", accepted: [], rejected, extraPassed: 0, reasons };
}

// Short fingerprint of the thresholds, stored with each decision so old verdicts stay explainable.
export function guardVersion(cfg: GuardConfig = GUARD): string {
  return createHash("sha256").update(JSON.stringify(cfg)).digest("hex").slice(0, 12);
}
