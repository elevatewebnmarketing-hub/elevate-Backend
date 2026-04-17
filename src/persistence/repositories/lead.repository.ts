import { and, count, desc, eq, gte, ilike, lte, or } from "drizzle-orm";
import type { Db } from "../db.js";
import {
  leadConstruction,
  leadRealEstate,
  leads,
} from "../schema.js";

export type LeadRow = typeof leads.$inferSelect;

export type LeadWithExtensions = LeadRow & {
  construction: typeof leadConstruction.$inferSelect | null;
  realEstate: typeof leadRealEstate.$inferSelect | null;
};

export type CreateLeadInput = {
  organizationId: string;
  siteId: string;
  clientId?: string | null;
  industryVertical: string;
  sourceSystem: string;
  sourceUrl?: string | null;
  landingPath?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  formId: string;
  campaignId?: string | null;
  submittedAt?: Date;
  ipHash?: string | null;
  userAgentTruncated?: string | null;
  email: string;
  phone?: string | null;
  fullName: string;
  message?: string | null;
  construction?: {
    projectType?: string | null;
    timeline?: string | null;
    budgetRange?: string | null;
  } | null;
  realEstate?: {
    propertyInterest?: string | null;
    locationPreference?: string | null;
    bedrooms?: string | null;
  } | null;
};

export function createLeadRepository(db: Db) {
  return {
    async create(input: CreateLeadInput): Promise<LeadRow> {
      return db.transaction(async (tx) => {
        const [lead] = await tx
          .insert(leads)
          .values({
            organizationId: input.organizationId,
            siteId: input.siteId,
            clientId: input.clientId ?? null,
            industryVertical: input.industryVertical,
            sourceSystem: input.sourceSystem,
            sourceUrl: input.sourceUrl ?? null,
            landingPath: input.landingPath ?? null,
            utmSource: input.utmSource ?? null,
            utmMedium: input.utmMedium ?? null,
            utmCampaign: input.utmCampaign ?? null,
            utmTerm: input.utmTerm ?? null,
            utmContent: input.utmContent ?? null,
            formId: input.formId,
            campaignId: input.campaignId ?? null,
            submittedAt: input.submittedAt ?? new Date(),
            ipHash: input.ipHash ?? null,
            userAgentTruncated: input.userAgentTruncated ?? null,
            email: input.email,
            phone: input.phone ?? null,
            fullName: input.fullName,
            message: input.message ?? null,
          })
          .returning();

        if (!lead) throw new Error("Lead insert failed");

        if (input.construction) {
          await tx.insert(leadConstruction).values({
            leadId: lead.id,
            projectType: input.construction.projectType ?? null,
            timeline: input.construction.timeline ?? null,
            budgetRange: input.construction.budgetRange ?? null,
          });
        }

        if (input.realEstate) {
          await tx.insert(leadRealEstate).values({
            leadId: lead.id,
            propertyInterest: input.realEstate.propertyInterest ?? null,
            locationPreference: input.realEstate.locationPreference ?? null,
            bedrooms: input.realEstate.bedrooms ?? null,
          });
        }

        return lead;
      });
    },

    async listForOrganization(
      organizationId: string,
      filters: {
        from?: Date;
        to?: Date;
        industryVertical?: string;
        sourceSystem?: string;
        campaignId?: string;
        q?: string;
        limit: number;
        offset: number;
      },
    ): Promise<LeadRow[]> {
      const conditions = [eq(leads.organizationId, organizationId)];

      if (filters.from) {
        conditions.push(gte(leads.submittedAt, filters.from));
      }
      if (filters.to) {
        conditions.push(lte(leads.submittedAt, filters.to));
      }
      if (filters.industryVertical) {
        conditions.push(eq(leads.industryVertical, filters.industryVertical));
      }
      if (filters.sourceSystem) {
        conditions.push(eq(leads.sourceSystem, filters.sourceSystem));
      }
      if (filters.campaignId) {
        conditions.push(eq(leads.campaignId, filters.campaignId));
      }
      if (filters.q?.trim()) {
        const pattern = `%${filters.q.trim()}%`;
        conditions.push(
          or(
            ilike(leads.email, pattern),
            ilike(leads.fullName, pattern),
            ilike(leads.message, pattern),
          )!,
        );
      }

      return db
        .select()
        .from(leads)
        .where(and(...conditions))
        .orderBy(desc(leads.submittedAt))
        .limit(filters.limit)
        .offset(filters.offset);
    },

    async getByIdForOrganization(
      organizationId: string,
      leadId: string,
    ): Promise<LeadWithExtensions | undefined> {
      const leadRows = await db
        .select()
        .from(leads)
        .where(
          and(eq(leads.organizationId, organizationId), eq(leads.id, leadId)),
        )
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

      return {
        ...lead,
        construction: c ?? null,
        realEstate: re ?? null,
      };
    },

    async countForOrganization(
      organizationId: string,
      filters: {
        from?: Date;
        to?: Date;
        industryVertical?: string;
        sourceSystem?: string;
        campaignId?: string;
        q?: string;
      },
    ): Promise<number> {
      const conditions = [eq(leads.organizationId, organizationId)];

      if (filters.from) {
        conditions.push(gte(leads.submittedAt, filters.from));
      }
      if (filters.to) {
        conditions.push(lte(leads.submittedAt, filters.to));
      }
      if (filters.industryVertical) {
        conditions.push(eq(leads.industryVertical, filters.industryVertical));
      }
      if (filters.sourceSystem) {
        conditions.push(eq(leads.sourceSystem, filters.sourceSystem));
      }
      if (filters.campaignId) {
        conditions.push(eq(leads.campaignId, filters.campaignId));
      }
      if (filters.q?.trim()) {
        const pattern = `%${filters.q.trim()}%`;
        conditions.push(
          or(
            ilike(leads.email, pattern),
            ilike(leads.fullName, pattern),
            ilike(leads.message, pattern),
          )!,
        );
      }

      const [row] = await db
        .select({ value: count() })
        .from(leads)
        .where(and(...conditions));

      return row?.value ?? 0;
    },
  };
}
