import { asc, eq } from "drizzle-orm";
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

    async listByOrganizationId(organizationId: string): Promise<SiteRow[]> {
      return db
        .select()
        .from(sites)
        .where(eq(sites.organizationId, organizationId))
        .orderBy(asc(sites.createdAt));
    },

    async findByIdAndOrganizationId(
      siteId: string,
      organizationId: string,
    ): Promise<SiteRow | undefined> {
      const rows = await db
        .select()
        .from(sites)
        .where(eq(sites.id, siteId))
        .limit(1);
      const row = rows[0];
      if (!row || row.organizationId !== organizationId) return undefined;
      return row;
    },

    async updateLeadsNotificationEmail(
      siteId: string,
      organizationId: string,
      leadsNotificationEmail: string | null,
    ): Promise<SiteRow | undefined> {
      const existing = await this.findByIdAndOrganizationId(siteId, organizationId);
      if (!existing) return undefined;
      const [row] = await db
        .update(sites)
        .set({ leadsNotificationEmail })
        .where(eq(sites.id, siteId))
        .returning();
      return row;
    },
  };
}

