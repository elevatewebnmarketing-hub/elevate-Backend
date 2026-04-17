import { and, eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { organizations, users } from "../schema.js";

export type UserRow = typeof users.$inferSelect;

export function createUserRepository(db: Db) {
  return {
    async findByOrgSlugAndEmail(
      organizationSlug: string,
      email: string,
    ): Promise<{ user: UserRow; organizationId: string } | undefined> {
      const rows = await db
        .select({
          user: users,
          organizationId: organizations.id,
        })
        .from(users)
        .innerJoin(organizations, eq(users.organizationId, organizations.id))
        .where(
          and(
            eq(organizations.slug, organizationSlug),
            eq(users.email, email.toLowerCase()),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) return undefined;
      return { user: row.user, organizationId: row.organizationId };
    },
  };
}
