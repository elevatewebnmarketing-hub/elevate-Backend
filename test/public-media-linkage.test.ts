import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";
import { buildServer } from "../src/http/build-server.js";
import { createDb } from "../src/persistence/db.js";
import {
  blogPosts,
  mediaAssets,
  organizations,
  portfolioProjects,
  users,
} from "../src/persistence/schema.js";

describe("Public CMS media linkage", () => {
  let app: Awaited<ReturnType<typeof buildServer>>["app"];
  const createdOrgIds: string[] = [];
  const env = loadEnv();
  const { db, client } = createDb(env);

  beforeAll(async () => {
    ({ app } = await buildServer(env));
  }, 60_000);

  afterAll(async () => {
    for (const orgId of createdOrgIds) {
      await db.delete(organizations).where(eq(organizations.id, orgId));
    }
    await app?.close();
    await client.end({ timeout: 5 });
  });

  it("returns non-null coverUrl and imageUrl when media assets are linked", async () => {
    const nonce = randomUUID().slice(0, 8);
    const orgSlug = `org-media-${nonce}`;
    const blogSlug = `post-media-${nonce}`;
    const blogCoverUrl = `https://res.cloudinary.com/demo/image/upload/v1/blog-${nonce}.jpg`;
    const projectImageUrl = `https://res.cloudinary.com/demo/image/upload/v1/project-${nonce}.jpg`;

    const [org] = await db
      .insert(organizations)
      .values({
        name: `Media Linkage ${nonce}`,
        slug: orgSlug,
      })
      .returning();
    if (!org) throw new Error("failed to create organization fixture");
    createdOrgIds.push(org.id);

    const [user] = await db
      .insert(users)
      .values({
        organizationId: org.id,
        email: `org-admin-${nonce}@example.com`,
        passwordHash: "not-used-in-this-test",
        role: "org_admin",
      })
      .returning();
    if (!user) throw new Error("failed to create user fixture");

    const [blogAsset] = await db
      .insert(mediaAssets)
      .values({
        organizationId: org.id,
        uploadedByUserId: user.id,
        cloudinaryPublicId: `blog-${nonce}`,
        cloudinaryResourceType: "image",
        secureUrl: blogCoverUrl,
        folder: `elevate/orgs/${org.id}/blog-cover`,
      })
      .returning();
    if (!blogAsset) throw new Error("failed to create blog media fixture");

    const [portfolioAsset] = await db
      .insert(mediaAssets)
      .values({
        organizationId: org.id,
        uploadedByUserId: user.id,
        cloudinaryPublicId: `portfolio-${nonce}`,
        cloudinaryResourceType: "image",
        secureUrl: projectImageUrl,
        folder: `elevate/orgs/${org.id}/portfolio`,
      })
      .returning();
    if (!portfolioAsset) throw new Error("failed to create portfolio media fixture");

    await db.insert(blogPosts).values({
      organizationId: org.id,
      slug: blogSlug,
      title: "Linked Cover",
      excerpt: "Has cover",
      body: "Body",
      status: "published",
      publishedAt: new Date(),
      coverMediaAssetId: blogAsset.id,
    });

    await db.insert(portfolioProjects).values({
      organizationId: org.id,
      title: "Linked Project",
      summary: "Summary",
      body: "Body",
      imageMediaAssetId: portfolioAsset.id,
      isPublished: true,
      sortOrder: 1,
    });

    const blogRes = await app.inject({
      method: "GET",
      url: `/v1/public/org/${encodeURIComponent(orgSlug)}/blog-posts?limit=20&offset=0`,
    });
    expect(blogRes.statusCode).toBe(200);
    const blogPayload = JSON.parse(blogRes.body) as {
      items: Array<{ slug: string; coverUrl: string | null }>;
    };
    const blogItem = blogPayload.items.find((item) => item.slug === blogSlug);
    expect(blogItem).toBeTruthy();
    expect(blogItem?.coverUrl).toBe(blogCoverUrl);

    const portfolioRes = await app.inject({
      method: "GET",
      url: `/v1/public/org/${encodeURIComponent(orgSlug)}/portfolio-projects?limit=20&offset=0`,
    });
    expect(portfolioRes.statusCode).toBe(200);
    const portfolioPayload = JSON.parse(portfolioRes.body) as {
      items: Array<{ title: string; imageUrl: string | null }>;
    };
    const projectItem = portfolioPayload.items.find(
      (item) => item.title === "Linked Project",
    );
    expect(projectItem).toBeTruthy();
    expect(projectItem?.imageUrl).toBe(projectImageUrl);
  });
});
