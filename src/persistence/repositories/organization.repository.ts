import { eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { organizations } from "../schema.js";

export type OrganizationRow = typeof organizations.$inferSelect;

export function createOrganizationRepository(db: Db) {
  return {
    async findById(id: string): Promise<OrganizationRow | undefined> {
      const rows = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, id))
        .limit(1);
      return rows[0];
    },

    async findBySlug(slug: string): Promise<OrganizationRow | undefined> {
      const rows = await db
        .select()
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .limit(1);
      return rows[0];
    },

    async updateLeadsNotificationEmail(
      organizationId: string,
      leadsNotificationEmail: string | null,
    ): Promise<OrganizationRow | undefined> {
      const [row] = await db
        .update(organizations)
        .set({
          leadsNotificationEmail,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, organizationId))
        .returning();
      return row;
    },
  };
}
