import { describe, expect, it } from "vitest";
import { costUsd } from "../src/config/pricing.js";
import { checkBudget } from "../src/domain/budget.js";
import { decideFlag, parseVisionOutput, type ImageTags } from "../src/domain/imageTags.js";
import { resolveInside } from "../src/services/ingestion.js";

const valid: ImageTags = {
  subject: "red fox",
  subject_label: "red_fox",
  category: "animal",
  attributes: ["Orange fur", "forest", "orange fur"],
  caption: "A red fox standing in a forest",
  confidence: 0.94,
};

describe("parseVisionOutput (never trust model output)", () => {
  it("accepts a response that matches the schema and normalises attributes", () => {
    const result = parseVisionOutput(JSON.stringify(valid));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tags.attributes).toEqual(["orange fur", "forest"]);
  });

  it.each([
    ["empty response", undefined],
    ["not JSON", "A red fox in a forest"],
    ["missing field", JSON.stringify({ ...valid, caption: undefined })],
    ["label outside the taxonomy", JSON.stringify({ ...valid, subject_label: "coyote" })],
    ["confidence above 1", JSON.stringify({ ...valid, confidence: 1.5 })],
    ["extra field", JSON.stringify({ ...valid, breed: "n/a" })],
    ["empty attributes", JSON.stringify({ ...valid, attributes: [] })],
  ])("rejects %s", (_name, text) => {
    const result = parseVisionOutput(text);
    expect(result.ok).toBe(false);
  });
});

describe("decideFlag (low confidence is flagged, not accepted)", () => {
  it("tags a confident, identified animal", () => {
    expect(decideFlag(valid)).toEqual({ status: "tagged", flagReason: null });
  });

  it("flags low confidence", () => {
    expect(decideFlag({ ...valid, confidence: 0.42 })).toEqual({
      status: "flagged",
      flagReason: "low_confidence (0.42 < 0.80)",
    });
  });

  it("flags the borderline 'wolfdog' confidence seen on a fresh re-run (0.75)", () => {
    expect(decideFlag({ ...valid, confidence: 0.75 }).status).toBe("flagged");
  });

  it("keeps clearly identified images (every clear image scored ≥ 0.88)", () => {
    expect(decideFlag({ ...valid, confidence: 0.88 }).status).toBe("tagged");
  });

  it("flags an unknown subject even when confident", () => {
    expect(decideFlag({ ...valid, subject_label: "unknown" }).flagReason).toBe("subject_unknown");
  });

  it("reports every reason", () => {
    const d = decideFlag({ ...valid, subject_label: "unknown", category: "other", confidence: 0.3 });
    expect(d.flagReason).toBe("low_confidence (0.30 < 0.80), subject_unknown, category_other");
  });
});

describe("budget guard", () => {
  const limits = { maxUsdPerDay: 1, maxCallsPerDay: 100 };

  it("allows calls under both limits", () => {
    expect(checkBudget({ usd: 0.5, calls: 10 }, limits)).toEqual({ allowed: true });
  });

  it("blocks at the call limit", () => {
    expect(checkBudget({ usd: 0, calls: 100 }, limits).allowed).toBe(false);
  });

  it("blocks at the dollar limit", () => {
    const check = checkBudget({ usd: 1.2, calls: 5 }, limits);
    expect(check.allowed).toBe(false);
    if (!check.allowed) expect(check.reason).toContain("daily budget reached");
  });
});

describe("costUsd", () => {
  it("prices input and output (incl. thinking) tokens per million", () => {
    expect(costUsd("gemini-3.8-flash", 1_000_000, 1_000_000)).toBeCloseTo(2.8);
    expect(costUsd("gemini-3.8-flash", 300, 150)).toBeCloseTo(0.000465);
  });
});

describe("resolveInside (no path traversal)", () => {
  it("accepts a folder inside the data dir", () => {
    expect(resolveInside("data", "images")).toMatch(/data[\\/]images$/);
  });

  it.each(["..", "../src", "images/../../src"])("rejects %s", (dir) => {
    expect(() => resolveInside("data", dir)).toThrow("inside the data directory");
  });
});
