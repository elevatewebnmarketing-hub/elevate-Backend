import { eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { sites } from "../schema.js";

export type SiteRow = typeof sites.$inferSelect;

export function createSiteRepository(db: Db) {
  return {
    async findByKeyHash(keyHash: string): Promise<SiteRow | undefined> {
      const rows = await db
        .select()
        .from(sites)
        .where(eq(sites.keyHash, keyHash))
        .limit(1);
      return rows[0];
    },
  };
}
