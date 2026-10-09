import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { workspaces } from "../db/schema.js";

export function workspacesRepo(db: Db) {
  return {
    async findByKeyHash(apiKeyHash: string) {
      const [row] = await db.select().from(workspaces).where(eq(workspaces.apiKeyHash, apiKeyHash)).limit(1);
      return row ?? null;
    },

    // Seed helper: creates the workspace, or rotates its key if it already exists.
    async upsert(name: string, apiKeyHash: string) {
      const [row] = await db
        .insert(workspaces)
        .values({ name, apiKeyHash })
        .onConflictDoUpdate({ target: workspaces.name, set: { apiKeyHash } })
        .returning();
      return row!;
    },
  };
}
