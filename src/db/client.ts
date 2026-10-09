import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema.js";

export function createDb(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    async ping(): Promise<boolean> {
      await db.execute(sql`select 1`);
      return true;
    },
    close: () => pool.end(),
  };
}

export type Database = ReturnType<typeof createDb>;
export type Db = Database["db"];
