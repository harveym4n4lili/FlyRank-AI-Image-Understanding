import { GUARD } from "../config/guard.js";
import { SUBJECT_LABELS, type SubjectLabel } from "../config/taxonomy.js";
import { guard, guardVersion, matchPost, type EvaluatedCandidate, type PostFacts } from "../domain/guard.js";
import { AppError } from "../lib/errors.js";
import type { EmbeddingsRepo } from "../repositories/embeddings.js";
import type { PostsRepo } from "../repositories/posts.js";
import type { SuggestionsRepo } from "../repositories/suggestions.js";

type Post = NonNullable<Awaited<ReturnType<PostsRepo["findById"]>>>;

// The post's facts as the guard sees them (unknown when extraction produced no valid label).
export function factsOf(post: Pick<Post, "subject" | "subjectLabel" | "category" | "title">): PostFacts {
  const label = (SUBJECT_LABELS as readonly string[]).includes(post.subjectLabel ?? "")
    ? (post.subjectLabel as SubjectLabel)
    : "unknown";
  return { subject: post.subject ?? post.title, subjectLabel: label, category: post.category ?? "other" };
}

function view(c: EvaluatedCandidate & { filePath?: string }, suggestionId?: string, reviewStatus?: string) {
  return {
    suggestionId,
    imageId: c.imageId,
    rank: c.rank,
    similarity: Number(c.similarity.toFixed(4)),
    verdict: c.verdict,
    file: c.filePath,
    subject: c.subject,
    subjectLabel: c.subjectLabel,
    caption: c.caption,
    reviewStatus,
    reasons: c.reasons,
  };
}

export function matchingService(deps: { posts: PostsRepo; embeddings: EmbeddingsRepo; suggestions: SuggestionsRepo }) {
  async function embeddedPost(workspaceId: string, postId: string) {
    const post = await deps.posts.findById(postId, workspaceId);
    if (!post) throw new AppError(404, "NOT_FOUND", "No such post");
    const embedding = post.status === "embedded" ? await deps.posts.getEmbedding(post.id) : null;
    if (!embedding) {
      throw new AppError(409, "POST_NOT_READY", `Post is not embedded yet (status: ${post.status}); try again shortly`);
    }
    return { post, vector: embedding.embedding };
  }

  return {
    // Rank → guard → store every decision → explain. Accepted suggestions go to human review.
    async matchForPost(workspaceId: string, postId: string, limit: number) {
      const { post, vector } = await embeddedPost(workspaceId, postId);
      const ranked = await deps.embeddings.rankImages(workspaceId, vector, limit);
      const outcome = matchPost(factsOf(post), ranked, GUARD);
      const version = guardVersion(GUARD);

      const evaluated = [...outcome.accepted, ...outcome.rejected];
      const stored = await deps.suggestions.upsertMany(
        evaluated.map((c) => ({
          workspaceId,
          postId: post.id,
          imageId: c.imageId,
          rank: c.rank,
          similarity: c.similarity,
          verdict: c.verdict,
          reasons: c.reasons,
          guardVersion: version,
          guardConfig: GUARD,
        })),
      );
      const byImage = new Map(stored.map((s) => [s.imageId, s]));
      const withFile = new Map(ranked.map((r) => [r.imageId, r.filePath]));
      const render = (c: EvaluatedCandidate) =>
        view({ ...c, filePath: withFile.get(c.imageId) }, byImage.get(c.imageId)?.id, byImage.get(c.imageId)?.reviewStatus);

      return {
        post: { id: post.id, slug: post.slug, title: post.title, subject: post.subject, subjectLabel: post.subjectLabel, category: post.category },
        result: outcome.result,
        guardVersion: version,
        suggestions: outcome.accepted.map(render),
        // Also passed the guard but beyond the top-K suggestions (not stored).
        alsoPassedNotShown: outcome.extraPassed,
        rejected: outcome.rejected.map(render),
        ...(outcome.result === "NO_CONFIDENT_MATCH" ? { reasons: outcome.reasons } : {}),
      };
    },

    // Runs the guard on one chosen image regardless of rank (probe 3). Nothing is stored.
    async checkCandidate(workspaceId: string, postId: string, imageId: string) {
      const { post, vector } = await embeddedPost(workspaceId, postId);
      const candidate = await deps.embeddings.similarityOf(workspaceId, vector, imageId);
      if (!candidate) throw new AppError(404, "NOT_FOUND", "No such image, or it has no embedding yet");
      const result = guard(factsOf(post), candidate, GUARD);
      return {
        post: { id: post.id, title: post.title, subjectLabel: post.subjectLabel },
        candidate: view({ ...candidate, ...result, rank: 0 }),
        verdict: result.verdict,
        reasons: result.reasons,
        guardVersion: guardVersion(GUARD),
      };
    },
  };
}

export type MatchingService = ReturnType<typeof matchingService>;
