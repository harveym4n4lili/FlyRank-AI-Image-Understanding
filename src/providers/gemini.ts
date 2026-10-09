import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { CATEGORIES, IMAGE_TAGS_JSON_SCHEMA } from "../domain/imageTags.js";
import { POST_SUBJECT_JSON_SCHEMA } from "../domain/postSubject.js";
import { LABEL_NAMES, SUBJECT_LABELS } from "../config/taxonomy.js";
import { EMBEDDING_DIMENSIONS } from "../db/schema.js";

export interface Usage {
  inputTokens: number;
  outputTokens: number; // includes thinking tokens
}

export interface ModelResult {
  text: string | undefined;
  usage: Usage;
  latencyMs: number;
}
export type VisionResult = ModelResult;

export interface VisionProvider {
  readonly model: string;
  describeImage(image: Buffer, mimeType: string): Promise<ModelResult>;
}

export interface PostSubjectProvider {
  readonly model: string;
  extractPostSubject(title: string, body: string): Promise<ModelResult>;
}

export interface EmbeddingResult {
  values: number[];
  usage: Usage;
  latencyMs: number;
}

export interface EmbeddingProvider {
  readonly model: string;
  embed(text: string): Promise<EmbeddingResult>;
}

const labelList = SUBJECT_LABELS.map((l) => `${l} (${LABEL_NAMES[l]})`).join(", ");

const VISION_PROMPT = `You tag images for a content-matching system. Look at the image and return JSON only.

Fields:
- subject: the main subject in plain words, e.g. "red fox", "siberian husky".
- subject_label: exactly one of: ${labelList}.
  Use the most specific label you are sure of. Use "other_animal" for animals not in the list and
  "unknown" when you cannot tell what the subject is.
- category: one of ${CATEGORIES.join(", ")}.
- attributes: 1-10 short visual descriptors (colour, setting, pose, lighting).
- caption: one factual sentence describing the image.
- confidence: your probability (0-1) that subject_label is correct. Lower it when the subject is small,
  distant, blurred, occluded, a silhouette, or easily confused with a similar animal (fox/wolf/dog,
  husky/wolf, deer species). Do not default to a high number.`;

const postPrompt = (title: string, body: string) => `You decide what a blog post is about so an image can be matched to it.
Return JSON only.

Fields:
- subject: the main subject of the post in plain words, e.g. "red fox", "emperor penguin", "sourdough bread".
- subject_label: exactly one of: ${labelList}.
  Map scientific or informal names to the label ("Vulpes vulpes" → red_fox, "grizzly" → brown_bear).
  Use a generic label (fox, bear, deer) when the post covers that whole group. Use "other_animal" for an animal
  that is not in the list, and "unknown" when the post is not about one identifiable subject.
- category: one of ${CATEGORIES.join(", ")}.

Title: ${title}

${body}`;

// Spaces calls out so a batch stays under the free tier's requests-per-minute limit.
class MinIntervalLimiter {
  private next = 0;
  constructor(private readonly intervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.intervalMs;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

// Vision tagging and post-subject extraction both use the Flash model (and share its rate limit).
export class GeminiFlashProvider implements VisionProvider, PostSubjectProvider {
  private readonly client: GoogleGenAI;
  private readonly limiter: MinIntervalLimiter;

  constructor(
    apiKey: string,
    readonly model: string,
    maxRequestsPerMinute: number,
  ) {
    this.client = new GoogleGenAI({ apiKey });
    this.limiter = new MinIntervalLimiter(Math.ceil(60_000 / maxRequestsPerMinute));
  }

  describeImage(image: Buffer, mimeType: string): Promise<ModelResult> {
    return this.generateJson(
      [{ inlineData: { mimeType, data: image.toString("base64") } }, { text: VISION_PROMPT }],
      IMAGE_TAGS_JSON_SCHEMA,
    );
  }

  extractPostSubject(title: string, body: string): Promise<ModelResult> {
    return this.generateJson([{ text: postPrompt(title, body) }], POST_SUBJECT_JSON_SCHEMA);
  }

  private async generateJson(
    parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[],
    schema: unknown,
  ): Promise<ModelResult> {
    await this.limiter.wait();
    const started = Date.now();
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: schema,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        temperature: 0,
      },
    });

    const usage = response.usageMetadata;
    return {
      text: response.text,
      latencyMs: Date.now() - started,
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      },
    };
  }
}

// Called over REST rather than the SDK because only the REST response includes usageMetadata,
// which the cost log needs.
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private readonly limiter: MinIntervalLimiter;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    maxRequestsPerMinute: number,
  ) {
    this.limiter = new MinIntervalLimiter(Math.ceil(60_000 / maxRequestsPerMinute));
  }

  async embed(text: string): Promise<EmbeddingResult> {
    await this.limiter.wait();
    const started = Date.now();
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType: "SEMANTIC_SIMILARITY",
        outputDimensionality: EMBEDDING_DIMENSIONS,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      embedding?: { values?: number[] };
      usageMetadata?: { promptTokenCount?: number };
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(`embedding request failed: HTTP ${res.status} ${json.error?.message ?? ""}`.trim());

    const values = json.embedding?.values;
    if (!values || values.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`embedding has ${values?.length ?? 0} dimensions, expected ${EMBEDDING_DIMENSIONS}`);
    }
    return {
      values: normalize(values),
      latencyMs: Date.now() - started,
      usage: { inputTokens: json.usageMetadata?.promptTokenCount ?? Math.ceil(text.length / 4), outputTokens: 0 },
    };
  }
}

// Truncated Gemini embeddings are not guaranteed unit length; cosine ranking assumes they are.
export function normalize(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return norm === 0 ? values : values.map((v) => v / norm);
}
