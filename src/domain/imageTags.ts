import { z } from "zod";
import { SUBJECT_LABELS } from "../config/taxonomy.js";
import { GUARD } from "../config/guard.js";

export const CATEGORIES = ["animal", "landscape", "food", "people", "object", "other"] as const;

// The exact shape the vision model must return (docs/SPEC.md#vision-output-schema).
export const ImageTags = z
  .object({
    subject: z.string().min(1).max(80),
    subject_label: z.enum(SUBJECT_LABELS),
    category: z.enum(CATEGORIES),
    attributes: z.array(z.string().min(1).max(40)).min(1).max(10),
    caption: z.string().min(10).max(300),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type ImageTags = z.infer<typeof ImageTags>;

// Sent to Gemini as responseJsonSchema so the model is constrained to the same shape we validate.
export const IMAGE_TAGS_JSON_SCHEMA = z.toJSONSchema(ImageTags);

export type ParseResult = { ok: true; tags: ImageTags } | { ok: false; error: string };

// Never trust model output: it must be JSON and must match the schema exactly.
export function parseVisionOutput(text: string | undefined): ParseResult {
  if (!text) return { ok: false, error: "empty response" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "response is not valid JSON" };
  }
  const parsed = ImageTags.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, error: `schema validation failed: ${issues.join("; ")}` };
  }
  // Attributes are stored as a set (image_tags primary key), so normalise them here.
  const attributes = [...new Set(parsed.data.attributes.map((a) => a.trim().toLowerCase()))];
  return { ok: true, tags: { ...parsed.data, attributes } };
}

export interface FlagDecision {
  status: "tagged" | "flagged";
  flagReason: string | null;
}

// Low-confidence or unidentifiable results are flagged for review instead of being accepted.
// Self-reported confidence is poorly calibrated, so an unknown label or "other" category also flags.
export function decideFlag(tags: ImageTags, minConfidence: number = GUARD.T_CONF): FlagDecision {
  const reasons: string[] = [];
  if (tags.confidence < minConfidence) {
    reasons.push(`low_confidence (${tags.confidence.toFixed(2)} < ${minConfidence.toFixed(2)})`);
  }
  if (tags.subject_label === "unknown") reasons.push("subject_unknown");
  if (tags.category === "other") reasons.push("category_other");
  return reasons.length ? { status: "flagged", flagReason: reasons.join(", ") } : { status: "tagged", flagReason: null };
}
