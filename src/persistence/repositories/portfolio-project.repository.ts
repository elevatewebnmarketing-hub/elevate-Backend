import { and, asc, count, eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { mediaAssets, portfolioProjects } from "../schema.js";

export type PortfolioProjectRow = typeof portfolioProjects.$inferSelect;

export type PortfolioProjectWithImage = PortfolioProjectRow & {
  imageSecureUrl: string | null;
};

export type CreatePortfolioProjectInput = {
  organizationId: string;
  title: string;
  summary?: string | null;
  body?: string | null;
  imageMediaAssetId: string | null;
  isPublished: boolean;
  sortOrder: number;
};

export type UpdatePortfolioProjectInput = Partial<{
  title: string;
  summary: string | null;
  body: string | null;
  imageMediaAssetId: string | null;
  isPublished: boolean;
  sortOrder: number;
}>;

export function createPortfolioProjectRepository(db: Db) {
  return {
    async create(input: CreatePortfolioProjectInput): Promise<PortfolioProjectRow> {
      const [row] = await db
        .insert(portfolioProjects)
        .values({
          organizationId: input.organizationId,
          title: input.title,
          summary: input.summary ?? null,
          body: input.body ?? null,
          imageMediaAssetId: input.imageMediaAssetId,
          isPublished: input.isPublished,
          sortOrder: input.sortOrder,
        })
        .returning();
      if (!row) throw new Error("portfolio project insert failed");
      return row;
    },

    async update(
      organizationId: string,
      id: string,
      patch: UpdatePortfolioProjectInput,
    ): Promise<PortfolioProjectRow | undefined> {
      const existing = await this.getById(organizationId, id);
      if (!existing) return undefined;
      const [row] = await db
        .update(portfolioProjects)
        .set({
          ...patch,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(portfolioProjects.id, id),
            eq(portfolioProjects.organizationId, organizationId),
          ),
        )
        .returning();
      return row;
    },

    async delete(organizationId: string, id: string): Promise<boolean> {
      const result = await db
        .delete(portfolioProjects)
        .where(
          and(
            eq(portfolioProjects.id, id),
            eq(portfolioProjects.organizationId, organizationId),
          ),
        )
        .returning({ id: portfolioProjects.id });
      return result.length > 0;
    },

    async getById(
      organizationId: string,
      id: string,
    ): Promise<PortfolioProjectRow | undefined> {
      const rows = await db
        .select()
        .from(portfolioProjects)
        .where(
          and(
            eq(portfolioProjects.organizationId, organizationId),
            eq(portfolioProjects.id, id),
          ),
        )
        .limit(1);
      return rows[0];
    },

    async getByIdWithImage(
      organizationId: string,
      id: string,
    ): Promise<PortfolioProjectWithImage | undefined> {
      const rows = await db
        .select({
          project: portfolioProjects,
          imageSecureUrl: mediaAssets.secureUrl,
        })
        .from(portfolioProjects)
        .leftJoin(
          mediaAssets,
          eq(portfolioProjects.imageMediaAssetId, mediaAssets.id),
        )
        .where(
          and(
            eq(portfolioProjects.organizationId, organizationId),
            eq(portfolioProjects.id, id),
          ),
        )
        .limit(1);
      const r = rows[0];
      if (!r) return undefined;
      return { ...r.project, imageSecureUrl: r.imageSecureUrl ?? null };
    },

    async listForOrganization(
      organizationId: string,
      filters: { limit: number; offset: number },
    ): Promise<PortfolioProjectWithImage[]> {
      const rows = await db
        .select({
          project: portfolioProjects,
          imageSecureUrl: mediaAssets.secureUrl,
        })
        .from(portfolioProjects)
        .leftJoin(
          mediaAssets,
          eq(portfolioProjects.imageMediaAssetId, mediaAssets.id),
        )
        .where(eq(portfolioProjects.organizationId, organizationId))
        .orderBy(asc(portfolioProjects.sortOrder), asc(portfolioProjects.createdAt))
        .limit(filters.limit)
        .offset(filters.offset);

      return rows.map((r) => ({
        ...r.project,
        imageSecureUrl: r.imageSecureUrl ?? null,
      }));
    },

    async listPublishedPublic(
      organizationId: string,
      filters: { limit: number; offset: number },
    ): Promise<PortfolioProjectWithImage[]> {
      const rows = await db
        .select({
          project: portfolioProjects,
          imageSecureUrl: mediaAssets.secureUrl,
        })
        .from(portfolioProjects)
        .leftJoin(
          mediaAssets,
          eq(portfolioProjects.imageMediaAssetId, mediaAssets.id),
        )
        .where(
          and(
            eq(portfolioProjects.organizationId, organizationId),
            eq(portfolioProjects.isPublished, true),
          ),
        )
        .orderBy(asc(portfolioProjects.sortOrder), asc(portfolioProjects.createdAt))
        .limit(filters.limit)
        .offset(filters.offset);

      return rows.map((r) => ({
        ...r.project,
        imageSecureUrl: r.imageSecureUrl ?? null,
      }));
    },

    async countForOrganization(organizationId: string): Promise<number> {
      const [row] = await db
        .select({ n: count() })
        .from(portfolioProjects)
        .where(eq(portfolioProjects.organizationId, organizationId));
      return row?.n ?? 0;
    },

    async countPublishedPublic(organizationId: string): Promise<number> {
      const [row] = await db
        .select({ n: count() })
        .from(portfolioProjects)
        .where(
          and(
            eq(portfolioProjects.organizationId, organizationId),
            eq(portfolioProjects.isPublished, true),
          ),
        );
      return row?.n ?? 0;
    },
  };
}
