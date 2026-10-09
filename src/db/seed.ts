// Creates the demo workspace, its API key and the demo blog posts. Idempotent: re-running keeps
// the workspace, (re)sets the key and skips posts that already exist (same slug).
// Uses DEMO_API_KEY when set so demos and evaluators get a stable key; otherwise generates one
// and prints it once (only its hash is stored).
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { loadEnv } from "../config/env.js";
import { hashApiKey } from "../http/auth.js";
import { matchingQueue, startBoss } from "../jobs/queues.js";
import { embeddingsRepo } from "../repositories/embeddings.js";
import { postsRepo } from "../repositories/posts.js";
import { workspacesRepo } from "../repositories/workspaces.js";
import { postsService } from "../services/posts.js";
import { createDb } from "./client.js";

const WORKSPACE_NAME = "demo";
const DemoPosts = z.array(z.object({ slug: z.string(), title: z.string(), body: z.string() }).strict());

const env = loadEnv();
const database = createDb(env.DATABASE_URL);
const boss = await startBoss(env.DATABASE_URL);
try {
  const apiKey = process.env.DEMO_API_KEY || `imk_${randomBytes(24).toString("base64url")}`;
  const workspace = await workspacesRepo(database.db).upsert(WORKSPACE_NAME, hashApiKey(apiKey));
  process.stdout.write(`Seeded workspace "${workspace.name}" (${workspace.id})\n`);
  process.stdout.write(
    process.env.DEMO_API_KEY
      ? "API key: the DEMO_API_KEY value from your .env\n"
      : `API key (shown once, store it now): ${apiKey}\n`,
  );

  const postsFile = join(env.DATA_DIR, "posts.json");
  if (existsSync(postsFile)) {
    const demoPosts = DemoPosts.parse(JSON.parse(readFileSync(postsFile, "utf8")));
    const service = postsService({
      posts: postsRepo(database.db),
      embeddings: embeddingsRepo(database.db),
      queue: matchingQueue(boss),
    });
    let created = 0;
    for (const post of demoPosts) if ((await service.create(workspace.id, post)).created) created++;
    process.stdout.write(`Demo posts: ${created} created, ${demoPosts.length - created} already existed (queued for embedding)\n`);
  }
} finally {
  await boss.stop({ graceful: true });
  await database.close();
}
