import { and, asc, count, eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { hiringPositions } from "../schema.js";

export type HiringPositionRow = typeof hiringPositions.$inferSelect;

export type CreateHiringPositionInput = {
  organizationId: string;
  title: string;
  description: string;
  location?: string | null;
  applicationUrl?: string | null;
  isPublished: boolean;
  sortOrder: number;
};

export type UpdateHiringPositionInput = Partial<{
  title: string;
  description: string;
  location: string | null;
  applicationUrl: string | null;
  isPublished: boolean;
  sortOrder: number;
}>;

export function createHiringPositionRepository(db: Db) {
  return {
    async create(input: CreateHiringPositionInput): Promise<HiringPositionRow> {
      const [row] = await db
        .insert(hiringPositions)
        .values({
          organizationId: input.organizationId,
          title: input.title,
          description: input.description,
          location: input.location ?? null,
          applicationUrl: input.applicationUrl ?? null,
          isPublished: input.isPublished,
          sortOrder: input.sortOrder,
        })
        .returning();
      if (!row) throw new Error("hiring position insert failed");
      return row;
    },

    async update(
      organizationId: string,
      id: string,
      patch: UpdateHiringPositionInput,
    ): Promise<HiringPositionRow | undefined> {
      const existing = await this.getById(organizationId, id);
      if (!existing) return undefined;
      const [row] = await db
        .update(hiringPositions)
        .set({
          ...patch,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(hiringPositions.id, id),
            eq(hiringPositions.organizationId, organizationId),
          ),
        )
        .returning();
      return row;
    },

    async delete(organizationId: string, id: string): Promise<boolean> {
      const result = await db
        .delete(hiringPositions)
        .where(
          and(
            eq(hiringPositions.id, id),
            eq(hiringPositions.organizationId, organizationId),
          ),
        )
        .returning({ id: hiringPositions.id });
      return result.length > 0;
    },

    async getById(
      organizationId: string,
      id: string,
    ): Promise<HiringPositionRow | undefined> {
      const rows = await db
        .select()
        .from(hiringPositions)
        .where(
          and(
            eq(hiringPositions.organizationId, organizationId),
            eq(hiringPositions.id, id),
          ),
        )
        .limit(1);
      return rows[0];
    },

    async listForOrganization(
      organizationId: string,
      filters: { limit: number; offset: number },
    ): Promise<HiringPositionRow[]> {
      return db
        .select()
        .from(hiringPositions)
        .where(eq(hiringPositions.organizationId, organizationId))
        .orderBy(asc(hiringPositions.sortOrder), asc(hiringPositions.createdAt))
        .limit(filters.limit)
        .offset(filters.offset);
    },

    async listPublishedPublic(
      organizationId: string,
      filters: { limit: number; offset: number },
    ): Promise<HiringPositionRow[]> {
      return db
        .select()
        .from(hiringPositions)
        .where(
          and(
            eq(hiringPositions.organizationId, organizationId),
            eq(hiringPositions.isPublished, true),
          ),
        )
        .orderBy(asc(hiringPositions.sortOrder), asc(hiringPositions.createdAt))
        .limit(filters.limit)
        .offset(filters.offset);
    },

    async countForOrganization(organizationId: string): Promise<number> {
      const [row] = await db
        .select({ n: count() })
        .from(hiringPositions)
        .where(eq(hiringPositions.organizationId, organizationId));
      return row?.n ?? 0;
    },

    async countPublishedPublic(organizationId: string): Promise<number> {
      const [row] = await db
        .select({ n: count() })
        .from(hiringPositions)
        .where(
          and(
            eq(hiringPositions.organizationId, organizationId),
            eq(hiringPositions.isPublished, true),
          ),
        );
      return row?.n ?? 0;
    },
  };
}
