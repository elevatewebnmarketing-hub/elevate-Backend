import { and, count, desc, eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { blogPosts, mediaAssets } from "../schema.js";

export type BlogPostRow = typeof blogPosts.$inferSelect;

export type BlogPostWithCover = BlogPostRow & {
  coverSecureUrl: string | null;
};

export type CreateBlogPostInput = {
  organizationId: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  body: string;
  status: string;
  publishedAt: Date | null;
  coverMediaAssetId: string | null;
};

export type UpdateBlogPostInput = Partial<{
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  status: string;
  publishedAt: Date | null;
  coverMediaAssetId: string | null;
}>;

export function createBlogPostRepository(db: Db) {
  return {
    async create(input: CreateBlogPostInput): Promise<BlogPostRow> {
      const [row] = await db
        .insert(blogPosts)
        .values({
          organizationId: input.organizationId,
          slug: input.slug,
          title: input.title,
          excerpt: input.excerpt ?? null,
          body: input.body,
          status: input.status,
          publishedAt: input.publishedAt,
          coverMediaAssetId: input.coverMediaAssetId,
        })
        .returning();
      if (!row) throw new Error("blog post insert failed");
      return row;
    },

    async update(
      organizationId: string,
      id: string,
      patch: UpdateBlogPostInput,
    ): Promise<BlogPostRow | undefined> {
      const existing = await this.getById(organizationId, id);
      if (!existing) return undefined;
      const [row] = await db
        .update(blogPosts)
        .set({
          ...patch,
          updatedAt: new Date(),
        })
        .where(and(eq(blogPosts.id, id), eq(blogPosts.organizationId, organizationId)))
        .returning();
      return row;
    },

    async delete(organizationId: string, id: string): Promise<boolean> {
      const result = await db
        .delete(blogPosts)
        .where(and(eq(blogPosts.id, id), eq(blogPosts.organizationId, organizationId)))
        .returning({ id: blogPosts.id });
      return result.length > 0;
    },

    async getById(
      organizationId: string,
      id: string,
    ): Promise<BlogPostRow | undefined> {
      const rows = await db
        .select()
        .from(blogPosts)
        .where(
          and(eq(blogPosts.organizationId, organizationId), eq(blogPosts.id, id)),
        )
        .limit(1);
      return rows[0];
    },

    async getByIdWithCover(
      organizationId: string,
      id: string,
    ): Promise<BlogPostWithCover | undefined> {
      const rows = await db
        .select({
          post: blogPosts,
          coverSecureUrl: mediaAssets.secureUrl,
        })
        .from(blogPosts)
        .leftJoin(mediaAssets, eq(blogPosts.coverMediaAssetId, mediaAssets.id))
        .where(
          and(eq(blogPosts.organizationId, organizationId), eq(blogPosts.id, id)),
        )
        .limit(1);
      const r = rows[0];
      if (!r) return undefined;
      return { ...r.post, coverSecureUrl: r.coverSecureUrl ?? null };
    },

    async getBySlugPublic(
      organizationId: string,
      slug: string,
    ): Promise<BlogPostWithCover | undefined> {
      const rows = await db
        .select({
          post: blogPosts,
          coverSecureUrl: mediaAssets.secureUrl,
        })
        .from(blogPosts)
        .leftJoin(mediaAssets, eq(blogPosts.coverMediaAssetId, mediaAssets.id))
        .where(
          and(
            eq(blogPosts.organizationId, organizationId),
            eq(blogPosts.slug, slug),
            eq(blogPosts.status, "published"),
          ),
        )
        .limit(1);
      const r = rows[0];
      if (!r) return undefined;
      return { ...r.post, coverSecureUrl: r.coverSecureUrl ?? null };
    },

    async listForOrganization(
      organizationId: string,
      filters: { limit: number; offset: number },
    ): Promise<BlogPostRow[]> {
      return db
        .select()
        .from(blogPosts)
        .where(eq(blogPosts.organizationId, organizationId))
        .orderBy(desc(blogPosts.updatedAt))
        .limit(filters.limit)
        .offset(filters.offset);
    },

    async listPublishedPublic(
      organizationId: string,
      filters: { limit: number; offset: number },
    ): Promise<BlogPostWithCover[]> {
      const rows = await db
        .select({
          post: blogPosts,
          coverSecureUrl: mediaAssets.secureUrl,
        })
        .from(blogPosts)
        .leftJoin(mediaAssets, eq(blogPosts.coverMediaAssetId, mediaAssets.id))
        .where(
          and(
            eq(blogPosts.organizationId, organizationId),
            eq(blogPosts.status, "published"),
          ),
        )
        .orderBy(desc(blogPosts.publishedAt), desc(blogPosts.createdAt))
        .limit(filters.limit)
        .offset(filters.offset);

      return rows.map((r) => ({ ...r.post, coverSecureUrl: r.coverSecureUrl ?? null }));
    },

    async countForOrganization(organizationId: string): Promise<number> {
      const [row] = await db
        .select({ n: count() })
        .from(blogPosts)
        .where(eq(blogPosts.organizationId, organizationId));
      return row?.n ?? 0;
    },

    async countPublishedPublic(organizationId: string): Promise<number> {
      const [row] = await db
        .select({ n: count() })
        .from(blogPosts)
        .where(
          and(
            eq(blogPosts.organizationId, organizationId),
            eq(blogPosts.status, "published"),
          ),
        );
      return row?.n ?? 0;
    },
  };
}
