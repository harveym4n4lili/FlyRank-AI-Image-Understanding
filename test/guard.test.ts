import { describe, expect, it } from "vitest";
import { guard, guardVersion, matchPost, type CandidateFacts, type PostFacts } from "../src/domain/guard.js";
import type { GuardConfig } from "../src/config/guard.js";

// Fixed thresholds for these tests, independent of the tuned values in src/config/guard.ts.
const CFG: GuardConfig = { T_CONF: 0.7, T_SIM: 0.7, T_SIM_STRICT: 0.8, TOP_K: 3 };
const g = (post: PostFacts, c: CandidateFacts) => guard(post, c, CFG);
const m = (post: PostFacts, cs: CandidateFacts[]) => matchPost(post, cs, CFG);

const foxPost: PostFacts = { subject: "red fox", subjectLabel: "red_fox", category: "animal" };

const candidate = (over: Partial<CandidateFacts>): CandidateFacts => ({
  imageId: "img",
  status: "tagged",
  subject: "red fox",
  subjectLabel: "red_fox",
  category: "animal",
  confidence: 0.95,
  caption: "A red fox in a forest",
  similarity: 0.85,
  ...over,
});

const fox = candidate({ imageId: "fox" });
const wolf = candidate({ imageId: "wolf", subject: "gray wolf", subjectLabel: "gray_wolf", caption: "A gray wolf in the forest", similarity: 0.8 });
const dog = candidate({ imageId: "dog", subject: "labrador", subjectLabel: "dog", caption: "A dog on grass", similarity: 0.7 });

describe("guard", () => {
  it("accepts the red fox for a red-fox post, with passing reasons", () => {
    const r = g(foxPost, fox);
    expect(r.verdict).toBe("ACCEPTED");
    expect(r.reasons.map((x) => x.code)).toEqual(["IMAGE_OK", "CATEGORY_OK", "SUBJECT_OK", "SIMILARITY_OK", "CONFIDENCE_OK"]);
  });

  it("rejects the wolf on a fox post even when similarity is high (probe 3)", () => {
    const r = g(foxPost, { ...wolf, similarity: 0.95 });
    expect(r.verdict).toBe("REJECTED");
    expect(r.reasons).toEqual([
      expect.objectContaining({ code: "SUBJECT_MISMATCH", message: "Subject mismatch: expected red fox, detected gray wolf" }),
    ]);
  });

  it("rejects a dog on a fox post", () => {
    expect(g(foxPost, dog).reasons[0]?.message).toBe("Subject mismatch: expected red fox, detected dog");
  });

  it("rejects a flagged image even if everything else matches", () => {
    const r = g(foxPost, { ...fox, status: "flagged", confidence: 0.65 });
    expect(r.verdict).toBe("REJECTED");
    expect(r.reasons.map((x) => x.code)).toEqual(["IMAGE_FLAGGED", "CONFIDENCE_LOW"]);
  });

  it("rejects low similarity with the numbers in the message", () => {
    const r = g(foxPost, { ...fox, similarity: 0.61 });
    expect(r.reasons).toEqual([expect.objectContaining({ code: "SIMILARITY_LOW", message: "Similarity 0.61 is below threshold 0.70" })]);
  });

  it("reports every failing rule, not just the first", () => {
    const r = g({ subject: "sourdough bread", subjectLabel: "unknown", category: "food" }, { ...wolf, similarity: 0.3 });
    expect(r.reasons.map((x) => x.code)).toEqual(["CATEGORY_MISMATCH", "SIMILARITY_LOW"]);
  });

  it("uses the strict threshold when the post subject is unknown", () => {
    const post: PostFacts = { subject: "wildlife", subjectLabel: "unknown", category: "animal" };
    expect(g(post, { ...fox, similarity: 0.75 }).verdict).toBe("REJECTED");
    expect(g(post, { ...fox, similarity: 0.85 }).verdict).toBe("ACCEPTED");
  });

  it("names the post's own subject when it is not in the taxonomy", () => {
    const penguinPost: PostFacts = { subject: "emperor penguin", subjectLabel: "other_animal", category: "animal" };
    expect(g(penguinPost, wolf).reasons[0]?.message).toBe("Subject mismatch: expected emperor penguin, detected gray wolf");
  });

  it("lets a generic post accept a specific image, but not the reverse", () => {
    expect(g({ subject: "foxes", subjectLabel: "fox", category: "animal" }, fox).verdict).toBe("ACCEPTED");
    const deerSilhouette = candidate({ subject: "deer", subjectLabel: "deer", caption: "Deer silhouette" });
    expect(g({ subject: "white-tailed deer", subjectLabel: "white_tailed_deer", category: "animal" }, deerSilhouette).verdict).toBe("REJECTED");
  });
});

describe("matchPost", () => {
  it("ranks the fox first and refuses the wolf and dog (probe 2)", () => {
    const out = m(foxPost, [fox, wolf, dog]);
    expect(out.result).toBe("MATCH");
    expect(out.accepted.map((a) => [a.imageId, a.rank])).toEqual([["fox", 1]]);
    expect(out.rejected.map((r) => r.imageId)).toEqual(["wolf", "dog"]);
  });

  it("returns NO_CONFIDENT_MATCH with reasons when nothing passes (probe 4)", () => {
    const penguinPost: PostFacts = { subject: "emperor penguin", subjectLabel: "other_animal", category: "animal" };
    const out = m(penguinPost, [{ ...wolf, similarity: 0.55 }, dog]);
    expect(out.result).toBe("NO_CONFIDENT_MATCH");
    expect(out.accepted).toEqual([]);
    expect(out.reasons[0]).toBe(
      'Best candidate #1 "A gray wolf in the forest" (similarity 0.55): Subject mismatch: expected emperor penguin, detected gray wolf; Similarity 0.55 is below threshold 0.70',
    );
  });

  it("caps accepted suggestions at TOP_K", () => {
    const foxes = [0.9, 0.89, 0.88, 0.87, 0.86].map((s, i) => candidate({ imageId: `fox${i}`, similarity: s }));
    const out = m(foxPost, foxes);
    expect(out.accepted).toHaveLength(CFG.TOP_K);
    expect(out.extraPassed).toBe(2);
  });

  it("explains an empty library", () => {
    expect(m(foxPost, []).reasons).toEqual(["No embedded images are available to compare against"]);
  });
});

describe("guardVersion", () => {
  it("changes when a threshold changes", () => {
    expect(guardVersion(CFG)).not.toBe(guardVersion({ ...CFG, T_SIM: 0.71 }));
    expect(guardVersion(CFG)).toHaveLength(12);
  });
});
