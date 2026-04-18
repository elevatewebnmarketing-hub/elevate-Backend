import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import type { Db } from "../db.js";
import { mediaAssets, organizations, users } from "../schema.js";

export type CreateMediaAssetInput = {
  organizationId: string;
  uploadedByUserId: string;
  cloudinaryPublicId: string;
  cloudinaryResourceType: "image" | "video";
  secureUrl: string;
  bytes?: string | null;
  width?: string | null;
  height?: string | null;
  durationSeconds?: string | null;
  format?: string | null;
  folder?: string | null;
  title?: string | null;
  purpose?: string | null;
  tags?: string[] | null;
};

export function createMediaAssetRepository(db: Db) {
  return {
    async create(input: CreateMediaAssetInput) {
      const [row] = await db.insert(mediaAssets).values(input).returning();
      return row;
    },

    async listForOrganization(
      organizationId: string,
      filters: { q?: string; resourceType?: "image" | "video"; limit: number; offset: number },
    ) {
      const conditions = [eq(mediaAssets.organizationId, organizationId)];
      if (filters.resourceType) {
        conditions.push(eq(mediaAssets.cloudinaryResourceType, filters.resourceType));
      }
      if (filters.q?.trim()) {
        const p = `%${filters.q.trim()}%`;
        conditions.push(
          or(
            ilike(mediaAssets.cloudinaryPublicId, p),
            ilike(mediaAssets.title, p),
            ilike(mediaAssets.purpose, p),
          )!,
        );
      }
      const whereClause = and(...conditions);

      const rows = await db
        .select({
          asset: mediaAssets,
          uploaderEmail: users.email,
        })
        .from(mediaAssets)
        .innerJoin(users, eq(mediaAssets.uploadedByUserId, users.id))
        .where(whereClause)
        .orderBy(desc(mediaAssets.createdAt))
        .limit(filters.limit)
        .offset(filters.offset);

      const [countRow] = await db
        .select({ n: count() })
        .from(mediaAssets)
        .where(whereClause);

      return { items: rows, total: countRow?.n ?? 0 };
    },

    async listForSuperAdmin(filters: {
      q?: string;
      organizationId?: string;
      resourceType?: "image" | "video";
      limit: number;
      offset: number;
    }) {
      const conditions = [];
      if (filters.organizationId) {
        conditions.push(eq(mediaAssets.organizationId, filters.organizationId));
      }
      if (filters.resourceType) {
        conditions.push(eq(mediaAssets.cloudinaryResourceType, filters.resourceType));
      }
      if (filters.q?.trim()) {
        const p = `%${filters.q.trim()}%`;
        conditions.push(
          or(
            ilike(mediaAssets.cloudinaryPublicId, p),
            ilike(mediaAssets.title, p),
            ilike(mediaAssets.purpose, p),
            ilike(users.email, p),
            ilike(organizations.name, p),
          )!,
        );
      }

      const base = db
        .select({
          asset: mediaAssets,
          organizationName: organizations.name,
          organizationSlug: organizations.slug,
          uploaderEmail: users.email,
        })
        .from(mediaAssets)
        .innerJoin(organizations, eq(mediaAssets.organizationId, organizations.id))
        .innerJoin(users, eq(mediaAssets.uploadedByUserId, users.id));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const rows = await (whereClause ? base.where(whereClause) : base)
        .orderBy(desc(mediaAssets.createdAt))
        .limit(filters.limit)
        .offset(filters.offset);

      const countBase = db.select({ n: count() }).from(mediaAssets);
      const [countRow] = await (whereClause
        ? countBase.where(whereClause)
        : countBase);

      return { items: rows, total: countRow?.n ?? 0 };
    },

    async existsForOrganization(
      assetId: string,
      organizationId: string,
    ): Promise<boolean> {
      const rows = await db
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.id, assetId),
            eq(mediaAssets.organizationId, organizationId),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
  };
}

