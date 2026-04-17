import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Env } from "../config/env.js";
import * as schema from "./schema.js";

export function createDb(env: Env) {
  const client = postgres(env.DATABASE_URL, { max: 10 });
  const db = drizzle(client, { schema });
  return { db, client };
}

export type Db = ReturnType<typeof createDb>["db"];
