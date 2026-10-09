// Creates the demo workspace and its API key. Idempotent: re-running keeps the workspace and
// (re)sets the key. Uses DEMO_API_KEY when set so demos and evaluators get a stable key;
// otherwise generates one and prints it once (only its hash is stored).
import { randomBytes } from "node:crypto";
import { loadEnv } from "../config/env.js";
import { hashApiKey } from "../http/auth.js";
import { workspacesRepo } from "../repositories/workspaces.js";
import { createDb } from "./client.js";

const WORKSPACE_NAME = "demo";

const env = loadEnv();
const database = createDb(env.DATABASE_URL);
try {
  const apiKey = process.env.DEMO_API_KEY || `imk_${randomBytes(24).toString("base64url")}`;
  const workspace = await workspacesRepo(database.db).upsert(WORKSPACE_NAME, hashApiKey(apiKey));

  process.stdout.write(`Seeded workspace "${workspace.name}" (${workspace.id})\n`);
  if (process.env.DEMO_API_KEY) {
    process.stdout.write("API key: the DEMO_API_KEY value from your .env\n");
  } else {
    process.stdout.write(`API key (shown once, store it now): ${apiKey}\n`);
  }
} finally {
  await database.close();
}
