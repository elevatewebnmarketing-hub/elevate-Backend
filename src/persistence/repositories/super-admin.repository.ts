import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import type { Db } from "../db.js";
import {
  leadConstruction,
  leadRealEstate,
  leads,
  mediaAssets,
  organizations,
  sites,
  superAdmins,
  users,
} from "../schema.js";
import { hashSiteKey } from "../site-key.js";
import type { Env } from "../../config/env.js";

export function createSuperAdminRepository(db: Db, env: Env) {
  return {
    async findByEmail(email: string) {
      const rows = await db
        .select()
        .from(superAdmins)
        .where(eq(superAdmins.email, email.toLowerCase()))
        .limit(1);
      return rows[0];
    },

    async countSuperAdmins() {
      const [row] = await db
        .select({ n: count() })
        .from(superAdmins);
      return row?.n ?? 0;
    },

    async insertSuperAdmin(email: string, passwordHash: string) {
      const [row] = await db
        .insert(superAdmins)
        .values({ email: email.toLowerCase(), passwordHash })
        .returning();
      return row;
    },

    async findSuperAdminById(id: string) {
      const rows = await db
        .select()
        .from(superAdmins)
        .where(eq(superAdmins.id, id))
        .limit(1);
      return rows[0];
    },

    async updateSuperAdminEmail(id: string, email: string) {
      const [row] = await db
        .update(superAdmins)
        .set({ email: email.toLowerCase() })
        .where(eq(superAdmins.id, id))
        .returning();
      return row;
    },

    async setSuperAdminPassword(id: string, plainPassword: string) {
      const passwordHash = await bcrypt.hash(plainPassword, 12);
      const [row] = await db
        .update(superAdmins)
        .set({ passwordHash })
        .where(eq(superAdmins.id, id))
        .returning();
      return row;
    },

    async listOrganizations() {
      return db.select().from(organizations).orderBy(desc(organizations.createdAt));
    },

    async getOrganization(id: string) {
      const rows = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, id))
        .limit(1);
      return rows[0];
    },

    async createOrganization(data: { name: string; slug: string }) {
      const [row] = await db
        .insert(organizations)
        .values({ name: data.name, slug: data.slug })
        .returning();
      return row;
    },

    async updateOrganization(
      id: string,
      data: { name?: string; slug?: string },
    ) {
      const [row] = await db
        .update(organizations)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, id))
        .returning();
      return row;
    },

    async deleteOrganization(id: string) {
      await db.delete(organizations).where(eq(organizations.id, id));
    },

    async listSites(organizationId?: string) {
      const base = db
        .select({
          site: sites,
          organizationName: organizations.name,
          organizationSlug: organizations.slug,
        })
        .from(sites)
        .innerJoin(organizations, eq(sites.organizationId, organizations.id));

      if (organizationId) {
        return base
          .where(eq(sites.organizationId, organizationId))
          .orderBy(desc(sites.createdAt));
      }
      return base.orderBy(desc(sites.createdAt));
    },

    async getSite(id: string) {
      const rows = await db.select().from(sites).where(eq(sites.id, id)).limit(1);
      return rows[0];
    },

    /**
     * Creates site with new publishable key. Returns row + plaintext key once.
     */
    async createSite(data: {
      organizationId: string;
      label: string;
      allowedOrigins?: string[] | null;
    }): Promise<{ site: typeof sites.$inferSelect; plaintextKey: string }> {
      const plaintextKey = `site_${randomBytes(16).toString("hex")}`;
      const keyHash = hashSiteKey(plaintextKey, env.SITE_KEY_PEPPER);
      const [site] = await db
        .insert(sites)
        .values({
          organizationId: data.organizationId,
          keyHash,
          label: data.label,
          allowedOrigins: data.allowedOrigins ?? null,
          isActive: true,
        })
        .returning();
      if (!site) throw new Error("Site insert failed");
      return { site, plaintextKey };
    },

    async updateSite(
      id: string,
      data: {
        label?: string;
        allowedOrigins?: string[] | null;
        isActive?: boolean;
      },
    ) {
      const [row] = await db
        .update(sites)
        .set(data)
        .where(eq(sites.id, id))
        .returning();
      return row;
    },

    /** New key hash; returns plaintext once. */
    async rotateSiteKey(siteId: string): Promise<{
      site: typeof sites.$inferSelect;
      plaintextKey: string;
    }> {
      const plaintextKey = `site_${randomBytes(16).toString("hex")}`;
      const keyHash = hashSiteKey(plaintextKey, env.SITE_KEY_PEPPER);
      const [site] = await db
        .update(sites)
        .set({
          keyHash,
          rotatedAt: new Date(),
        })
        .where(eq(sites.id, siteId))
        .returning();
      if (!site) throw new Error("Site not found");
      return { site, plaintextKey };
    },

    async deleteSite(id: string) {
      await db.delete(sites).where(eq(sites.id, id));
    },

    async listUsers(organizationId?: string) {
      const base = db
        .select({
          user: users,
          organizationName: organizations.name,
          organizationSlug: organizations.slug,
        })
        .from(users)
        .innerJoin(organizations, eq(users.organizationId, organizations.id));

      if (organizationId) {
        return base
          .where(eq(users.organizationId, organizationId))
          .orderBy(desc(users.createdAt));
      }
      return base.orderBy(desc(users.createdAt));
    },

    async getUser(id: string) {
      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return rows[0];
    },

    async createUser(data: {
      organizationId: string;
      email: string;
      password: string;
      role: string;
    }) {
      const passwordHash = await bcrypt.hash(data.password, 12);
      const [row] = await db
        .insert(users)
        .values({
          organizationId: data.organizationId,
          email: data.email.toLowerCase(),
          passwordHash,
          role: data.role,
        })
        .returning();
      return row;
    },

    async updateUser(
      id: string,
      data: { email?: string; role?: string },
    ) {
      const [row] = await db
        .update(users)
        .set(data)
        .where(eq(users.id, id))
        .returning();
      return row;
    },

    async setUserPassword(id: string, password: string) {
      const passwordHash = await bcrypt.hash(password, 12);
      const [row] = await db
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, id))
        .returning();
      return row;
    },

    async deleteUser(id: string) {
      await db.delete(users).where(eq(users.id, id));
    },

    async listLeads(filters: {
      q?: string;
      organizationId?: string;
      limit: number;
      offset: number;
    }) {
      const conditions = [];
      if (filters.organizationId) {
        conditions.push(eq(leads.organizationId, filters.organizationId));
      }
      if (filters.q?.trim()) {
        const p = `%${filters.q.trim()}%`;
        conditions.push(
          or(
            ilike(leads.email, p),
            ilike(leads.fullName, p),
            ilike(leads.message, p),
          )!,
        );
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const listBase = db
        .select({
          lead: leads,
          organizationName: organizations.name,
          siteLabel: sites.label,
        })
        .from(leads)
        .innerJoin(organizations, eq(leads.organizationId, organizations.id))
        .innerJoin(sites, eq(leads.siteId, sites.id));
      const rows = await (whereClause
        ? listBase.where(whereClause)
        : listBase
      )
        .orderBy(desc(leads.submittedAt))
        .limit(filters.limit)
        .offset(filters.offset);

      const countBase = db.select({ n: count() }).from(leads);
      const [countRow] = await (whereClause
        ? countBase.where(whereClause)
        : countBase);

      return {
        items: rows,
        total: countRow?.n ?? 0,
      };
    },

    async getLeadWithExtensions(leadId: string) {
      const leadRows = await db
        .select()
        .from(leads)
        .where(eq(leads.id, leadId))
        .limit(1);
      const lead = leadRows[0];
      if (!lead) return undefined;

      const [c] = await db
        .select()
        .from(leadConstruction)
        .where(eq(leadConstruction.leadId, leadId))
        .limit(1);
      const [re] = await db
        .select()
        .from(leadRealEstate)
        .where(eq(leadRealEstate.leadId, leadId))
        .limit(1);

      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, lead.organizationId))
        .limit(1);
      const [site] = await db
        .select()
        .from(sites)
        .where(eq(sites.id, lead.siteId))
        .limit(1);

      return {
        ...lead,
        organization: org ?? null,
        site: site ?? null,
        construction: c ?? null,
        realEstate: re ?? null,
      };
    },

    async deleteLead(leadId: string) {
      await db.delete(leads).where(eq(leads.id, leadId));
    },

    async listMediaAssets(filters: {
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
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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
      const rows = await (whereClause ? base.where(whereClause) : base)
        .orderBy(desc(mediaAssets.createdAt))
        .limit(filters.limit)
        .offset(filters.offset);

      const countBase = db.select({ n: count() }).from(mediaAssets);
      const [countRow] = await (whereClause
        ? countBase.where(whereClause)
        : countBase);

      return {
        items: rows,
        total: countRow?.n ?? 0,
      };
    },
  };
}
