import { describe, expect, it } from "vitest";
import { labelsCompatible } from "../src/config/taxonomy.js";

describe("labelsCompatible", () => {
  it("accepts an exact match", () => {
    expect(labelsCompatible("red_fox", "red_fox")).toBe(true);
  });

  it("rejects the wolf for a red-fox post", () => {
    expect(labelsCompatible("red_fox", "gray_wolf")).toBe(false);
  });

  it("rejects a dog for a red-fox post", () => {
    expect(labelsCompatible("red_fox", "dog")).toBe(false);
  });

  it("lets a generic post accept its specific children", () => {
    expect(labelsCompatible("fox", "red_fox")).toBe(true);
    expect(labelsCompatible("fox", "arctic_fox")).toBe(true);
    expect(labelsCompatible("bear", "polar_bear")).toBe(true);
  });

  it("does not let a specific post accept a sibling or the generic label", () => {
    expect(labelsCompatible("red_fox", "arctic_fox")).toBe(false);
    expect(labelsCompatible("red_fox", "fox")).toBe(false);
  });

  it("never matches open labels", () => {
    expect(labelsCompatible("unknown", "unknown")).toBe(false);
    expect(labelsCompatible("other_animal", "other_animal")).toBe(false);
    expect(labelsCompatible("red_fox", "unknown")).toBe(false);
  });
});
