import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { CATEGORIES, IMAGE_TAGS_JSON_SCHEMA } from "../domain/imageTags.js";
import { LABEL_NAMES, SUBJECT_LABELS } from "../config/taxonomy.js";

export interface Usage {
  inputTokens: number;
  outputTokens: number; // includes thinking tokens
}

export interface VisionResult {
  text: string | undefined;
  usage: Usage;
  latencyMs: number;
}

export interface VisionProvider {
  readonly model: string;
  describeImage(image: Buffer, mimeType: string): Promise<VisionResult>;
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

export class GeminiVisionProvider implements VisionProvider {
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

  async describeImage(image: Buffer, mimeType: string): Promise<VisionResult> {
    await this.limiter.wait();
    const started = Date.now();
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType, data: image.toString("base64") } }, { text: VISION_PROMPT }],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: IMAGE_TAGS_JSON_SCHEMA,
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
