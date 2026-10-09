import { z } from "zod";
import { SUBJECT_LABELS } from "../config/taxonomy.js";
import { CATEGORIES } from "./imageTags.js";

// What a post is about, extracted by the text model and validated exactly like vision output.
export const PostSubject = z
  .object({
    subject: z.string().min(1).max(80),
    subject_label: z.enum(SUBJECT_LABELS),
    category: z.enum(CATEGORIES),
  })
  .strict();

export type PostSubject = z.infer<typeof PostSubject>;

export const POST_SUBJECT_JSON_SCHEMA = z.toJSONSchema(PostSubject);

export type PostSubjectParse = { ok: true; value: PostSubject } | { ok: false; error: string };

export function parsePostSubject(text: string | undefined): PostSubjectParse {
  if (!text) return { ok: false, error: "empty response" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "response is not valid JSON" };
  }
  const parsed = PostSubject.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, error: `schema validation failed: ${issues.join("; ")}` };
  }
  return { ok: true, value: parsed.data };
}

// The text that represents each side in the shared embedding space.
export function postEmbeddingText(post: { title: string; body: string }): string {
  return `${post.title}\n\n${post.body}`.slice(0, 8000);
}

export function imageEmbeddingText(image: { subject: string | null; caption: string | null; attributes: string[] }): string {
  return [image.subject, image.caption, image.attributes.length ? `Attributes: ${image.attributes.join(", ")}.` : ""]
    .filter(Boolean)
    .join(". ");
}
