// Measures matching quality on the hand-labeled eval set (eval/posts.json, docs/GUARD_AND_EVAL.md#eval-set).
//
//   npm run eval            # metrics with the current thresholds (src/config/guard.ts)
//   npm run eval -- --sweep # also re-run the guard over a range of T_SIM values
//
// Needs the stack running (docker compose up -d) and the demo workspace seeded: missing eval posts are
// created through the normal posts service, so the worker extracts and embeds them. Ground truth is the
// manifest's expected_label for each image, never the model's own label. Nothing is stored.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { GUARD, type GuardConfig } from "../src/config/guard.js";
import { loadEnv } from "../src/config/env.js";
import { createDb } from "../src/db/client.js";
import { guardVersion, matchPost, type CandidateFacts, type PostFacts } from "../src/domain/guard.js";
import { matchingQueue, startBoss } from "../src/jobs/queues.js";
import { embeddingsRepo } from "../src/repositories/embeddings.js";
import { postsRepo } from "../src/repositories/posts.js";
import { workspacesRepo } from "../src/repositories/workspaces.js";
import { factsOf } from "../src/services/matching.js";
import { postsService } from "../src/services/posts.js";

const CANDIDATES = 10;
const WAIT_MS = 5 * 60_000;

const EvalPost = z.object({
  slug: z.string(),
  type: z.enum(["positive", "synonym", "negative", "near_miss"]),
  expected_labels: z.array(z.string()).optional(),
  expected: z.literal("NO_CONFIDENT_MATCH").optional(),
  title: z.string(),
  body: z.string(),
});
type EvalPost = z.infer<typeof EvalPost>;

interface Prepared {
  spec: EvalPost;
  facts: PostFacts;
  ranked: (CandidateFacts & { filePath: string })[];
}

interface PostResult {
  slug: string;
  type: EvalPost["type"];
  postLabel: string;
  result: "MATCH" | "NO_CONFIDENT_MATCH";
  top1: string | null;
  top1Label: string | null;
  correct: boolean;
  wrongAccepts: string[];
  /** Label of the highest-similarity image, before the guard runs (baseline). */
  rankOnlyTop1Label: string | null;
}

const fmt = (n: number) => n.toFixed(3);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function isPositive(p: EvalPost) {
  return p.type === "positive" || p.type === "synonym";
}

// Scores one guard configuration against the prepared posts (pure: no I/O).
function evaluate(prepared: Prepared[], truth: Map<string, string>, cfg: GuardConfig) {
  const results: PostResult[] = prepared.map(({ spec, facts, ranked }) => {
    const outcome = matchPost(facts, ranked, cfg);
    const accepted = outcome.accepted as (CandidateFacts & { filePath?: string })[];
    const labelOf = (c: { filePath?: string }) => truth.get(c.filePath ?? "") ?? "unknown";
    const top = accepted[0];
    const expected = new Set(spec.expected_labels ?? []);
    const wrongAccepts = accepted.filter((c) => !expected.has(labelOf(c))).map((c) => (c.filePath ?? "").replace("images/", ""));
    const correct = isPositive(spec) ? !!top && expected.has(labelOf(top)) : outcome.result === "NO_CONFIDENT_MATCH";
    return {
      slug: spec.slug,
      type: spec.type,
      postLabel: facts.subjectLabel,
      result: outcome.result,
      top1: top ? (top.filePath ?? "").replace("images/", "") : null,
      top1Label: top ? labelOf(top) : null,
      correct,
      wrongAccepts,
      rankOnlyTop1Label: ranked[0] ? labelOf(ranked[0]) : null,
    };
  });

  const positives = results.filter((r) => r.type === "positive" || r.type === "synonym");
  const negatives = results.filter((r) => r.type === "negative" || r.type === "near_miss");
  const answered = positives.filter((r) => r.result === "MATCH");
  const correct = positives.filter((r) => r.correct).length;
  return {
    results,
    metrics: {
      positives: positives.length,
      negatives: negatives.length,
      top1Correct: correct,
      // Headline: share of positive posts whose first suggestion is a correct image (an abstention counts as a miss).
      top1Precision: positives.length ? correct / positives.length : 0,
      precisionWhenAnswered: answered.length ? correct / answered.length : 0,
      coverage: positives.length ? answered.length / positives.length : 0,
      abstentionAccuracy: negatives.length ? negatives.filter((r) => r.correct).length / negatives.length : 0,
      wrongAccepts: results.reduce((n, r) => n + r.wrongAccepts.length, 0),
      // Baseline without the guard: is the single most similar image correct? (negatives always "answer" here)
      rankOnlyTop1Precision: positives.length
        ? positives.filter((r) => new Set(prepared.find((p) => p.spec.slug === r.slug)!.spec.expected_labels).has(r.rankOnlyTop1Label ?? "")).length /
          positives.length
        : 0,
    },
  };
}

async function main() {
  const sweep = process.argv.includes("--sweep");
  const env = loadEnv();
  const specs = z.array(EvalPost).parse(JSON.parse(readFileSync("eval/posts.json", "utf8")));
  const manifest = z
    .array(z.object({ id: z.string(), expected_label: z.string() }).passthrough())
    .parse(JSON.parse(readFileSync("data/manifest.json", "utf8")));
  const truth = new Map(manifest.map((m) => [`images/${m.id}.jpg`, m.expected_label]));

  const database = createDb(env.DATABASE_URL);
  const boss = await startBoss(env.DATABASE_URL);
  try {
    const workspace = await workspacesRepo(database.db).findByName("demo");
    if (!workspace) throw new Error('Workspace "demo" not found: run the seed step first');
    const posts = postsRepo(database.db);
    const embeddings = embeddingsRepo(database.db);
    const service = postsService({ posts, embeddings, queue: matchingQueue(boss) });

    // Make sure every eval post exists and is embedded (created through the normal pipeline).
    const ids = new Map<string, string>();
    for (const spec of specs) {
      const { post } = await service.create(workspace.id, { slug: spec.slug, title: spec.title, body: spec.body });
      ids.set(spec.slug, post.id);
    }
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const rows = await Promise.all([...ids.values()].map((id) => posts.findById(id)));
      const notReady = rows.filter((r) => r?.status !== "embedded");
      if (notReady.length === 0) break;
      if (notReady.some((r) => r?.status === "failed")) throw new Error("an eval post failed processing; check the worker logs");
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${notReady.length} eval post(s) to embed (is the worker running?)`);
      process.stdout.write(`waiting for ${notReady.length} eval post(s) to be embedded...\n`);
      await new Promise((r) => setTimeout(r, 5000));
    }

    const prepared: Prepared[] = [];
    for (const spec of specs) {
      const post = (await posts.findById(ids.get(spec.slug)!))!;
      const vector = (await posts.getEmbedding(post.id))!.embedding;
      const ranked = await embeddings.rankImages(workspace.id, vector, CANDIDATES);
      prepared.push({ spec, facts: factsOf(post), ranked });
    }

    const { results, metrics } = evaluate(prepared, truth, GUARD);
    console.log(`\nEval set: ${specs.length} posts (${metrics.positives} with a correct image, ${metrics.negatives} without)`);
    console.log(`Thresholds: T_SIM=${GUARD.T_SIM} T_SIM_STRICT=${GUARD.T_SIM_STRICT} T_CONF=${GUARD.T_CONF} (guard ${guardVersion(GUARD)})\n`);
    console.log("| post | type | post label | result | top-1 image | correct |");
    console.log("|---|---|---|---|---|---|");
    for (const r of results) {
      const extra = r.wrongAccepts.length ? ` ⚠ wrong accepts: ${r.wrongAccepts.join(", ")}` : "";
      console.log(`| ${r.slug} | ${r.type} | ${r.postLabel} | ${r.result} | ${r.top1 ?? "—"} | ${r.correct ? "✓" : "✗"}${extra} |`);
    }
    console.log(`\nTop-1 precision:         ${pct(metrics.top1Precision)} (${metrics.top1Correct}/${metrics.positives})`);
    console.log(`Precision when answered: ${pct(metrics.precisionWhenAnswered)}`);
    console.log(`Coverage:                ${pct(metrics.coverage)}`);
    console.log(`Abstention accuracy:     ${pct(metrics.abstentionAccuracy)}`);
    console.log(`Wrong accepts:           ${metrics.wrongAccepts}`);
    console.log(`
Baseline, ranking only (no guard): top-1 precision ${pct(metrics.rankOnlyTop1Precision)}, and every negative post would get an image`);
    const flips = results.filter((r) => r.correct && (r.type === "positive" || r.type === "synonym") && r.rankOnlyTop1Label !== r.top1Label);
    for (const r of flips) console.log(`  guard fixed ${r.slug}: most similar image was a ${r.rankOnlyTop1Label}, guard picked ${r.top1} (${r.top1Label})`);

    const report: Record<string, unknown> = {
      ranAt: new Date().toISOString(),
      thresholds: GUARD,
      guardVersion: guardVersion(GUARD),
      metrics,
      results,
    };

    if (sweep) {
      console.log("\nT_SIM sweep (T_SIM_STRICT and T_CONF unchanged):\n");
      console.log("| T_SIM | top-1 precision | when answered | coverage | abstention | wrong accepts |");
      console.log("|---|---|---|---|---|---|");
      const rows = [];
      for (let t = 0.4; t <= 0.8001; t += 0.02) {
        const cfg = { ...GUARD, T_SIM: Number(t.toFixed(2)) };
        const m = evaluate(prepared, truth, cfg).metrics;
        rows.push({ T_SIM: cfg.T_SIM, ...m });
        console.log(
          `| ${cfg.T_SIM.toFixed(2)} | ${pct(m.top1Precision)} | ${pct(m.precisionWhenAnswered)} | ${pct(m.coverage)} | ${pct(m.abstentionAccuracy)} | ${m.wrongAccepts} |`,
        );
      }
      report.sweep = rows;

      // Similarity evidence for the fox/wolf boundary.
      const fox = prepared.find((p) => p.spec.slug === "red-fox-behaviour");
      if (fox) {
        const best = (prefix: string) => fox.ranked.find((c) => c.filePath.includes(prefix));
        const f = best("red-fox");
        const w = best("gray-wolf");
        console.log(
          `\nFox/wolf boundary (red-fox-behaviour, top ${CANDIDATES}): best fox ${f ? fmt(f.similarity) : "—"}, best wolf ${w ? fmt(w.similarity) : "not in top " + CANDIDATES}`,
        );
      }
    }

    mkdirSync("eval/results", { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(`eval/results/${stamp}.json`, JSON.stringify(report, null, 2) + "\n");
    writeFileSync("eval/results/latest.json", JSON.stringify(report, null, 2) + "\n");
    console.log(`\nSaved eval/results/${stamp}.json (and latest.json)`);
  } finally {
    await boss.stop({ graceful: true });
    await database.close();
  }
}

await main();
