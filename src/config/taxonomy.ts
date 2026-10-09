// Controlled subject vocabulary shared by the vision prompt, post extraction and the guard.
// Free-text `subject` handles synonyms for ranking; these labels give the guard a crisp yes/no.
// See docs/GUARD_AND_EVAL.md#why-a-controlled-subject-label.

export const SUBJECT_LABELS = [
  // Specific labels: what an image can be tagged as.
  "red_fox",
  "arctic_fox",
  "gray_wolf",
  "dog",
  "brown_bear",
  "black_bear",
  "polar_bear",
  "white_tailed_deer",
  "red_deer",
  "moose",
  // Generic labels: mostly for posts that talk about a group ("foxes", "bears").
  "fox",
  "bear",
  "deer",
  // Escape hatches: never satisfy the subject rule on their own.
  "other_animal",
  "unknown",
] as const;

export type SubjectLabel = (typeof SUBJECT_LABELS)[number];

export const LABEL_NAMES: Record<SubjectLabel, string> = {
  red_fox: "red fox",
  arctic_fox: "arctic fox",
  gray_wolf: "gray wolf",
  dog: "dog",
  brown_bear: "brown bear",
  black_bear: "black bear",
  polar_bear: "polar bear",
  white_tailed_deer: "white-tailed deer",
  red_deer: "red deer",
  moose: "moose",
  fox: "fox",
  bear: "bear",
  deer: "deer",
  other_animal: "other animal",
  unknown: "unknown subject",
};

// A generic label accepts each of its children; a specific label accepts only itself.
const CHILDREN: Partial<Record<SubjectLabel, readonly SubjectLabel[]>> = {
  fox: ["red_fox", "arctic_fox"],
  bear: ["brown_bear", "black_bear", "polar_bear"],
  deer: ["white_tailed_deer", "red_deer", "moose"],
};

const OPEN_LABELS: ReadonlySet<SubjectLabel> = new Set(["other_animal", "unknown"]);

// True when the post label is too vague to run the subject rule (the guard then
// relies on the stricter similarity floor instead).
export function isOpenLabel(label: SubjectLabel): boolean {
  return OPEN_LABELS.has(label);
}

// Does an image tagged `imageLabel` satisfy a post about `postLabel`?
export function labelsCompatible(postLabel: SubjectLabel, imageLabel: SubjectLabel): boolean {
  if (isOpenLabel(postLabel) || isOpenLabel(imageLabel)) return false;
  if (postLabel === imageLabel) return true;
  return CHILDREN[postLabel]?.includes(imageLabel) ?? false;
}
