import { createLeadRepository } from "../persistence/repositories/lead.repository.js";

type LeadRepo = ReturnType<typeof createLeadRepository>;

export type ListLeadsQuery = {
  from?: string;
  to?: string;
  industryVertical?: string;
  sourceSystem?: string;
  campaignId?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

export function createListLeadsService(leadRepo: LeadRepo) {
  return {
    async list(organizationId: string, query: ListLeadsQuery) {
      const limit = Math.min(query.limit ?? 50, 100);
      const offset = query.offset ?? 0;
      const filters = {
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        industryVertical: query.industryVertical,
        sourceSystem: query.sourceSystem,
        campaignId: query.campaignId,
        q: query.q,
        limit,
        offset,
      };
      const [items, total] = await Promise.all([
        leadRepo.listForOrganization(organizationId, filters),
        leadRepo.countForOrganization(organizationId, filters),
      ]);
      return { items, total, limit, offset };
    },

    async getById(organizationId: string, leadId: string) {
      return leadRepo.getByIdForOrganization(organizationId, leadId);
    },
  };
}
