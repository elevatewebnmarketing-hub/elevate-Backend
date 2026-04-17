import { z } from "zod";
import { INDUSTRY_VERTICALS } from "../domain/constants.js";
import { createLeadRepository } from "../persistence/repositories/lead.repository.js";

type LeadRepo = ReturnType<typeof createLeadRepository>;
import type { SiteRow } from "../persistence/repositories/site.repository.js";

const extensionConstruction = z
  .object({
    projectType: z.string().max(500).optional().nullable(),
    timeline: z.string().max(500).optional().nullable(),
    budgetRange: z.string().max(500).optional().nullable(),
  })
  .optional()
  .nullable();

const extensionRealEstate = z
  .object({
    propertyInterest: z.string().max(500).optional().nullable(),
    locationPreference: z.string().max(500).optional().nullable(),
    bedrooms: z.string().max(100).optional().nullable(),
  })
  .optional()
  .nullable();

export const submitLeadBodySchema = z
  .object({
    industryVertical: z.enum(INDUSTRY_VERTICALS),
    clientId: z.string().max(200).optional().nullable(),
    sourceSystem: z.string().min(1).max(200),
    sourceUrl: z.string().max(2000).optional().nullable(),
    landingPath: z.string().max(2000).optional().nullable(),
    utmSource: z.string().max(200).optional().nullable(),
    utmMedium: z.string().max(200).optional().nullable(),
    utmCampaign: z.string().max(200).optional().nullable(),
    utmTerm: z.string().max(200).optional().nullable(),
    utmContent: z.string().max(200).optional().nullable(),
    formId: z.string().min(1).max(200),
    campaignId: z.string().max(200).optional().nullable(),
    submittedAt: z.coerce.date().optional(),
    email: z.string().email().max(320),
    phone: z.string().max(50).optional().nullable(),
    fullName: z.string().min(1).max(500),
    message: z.string().max(10000).optional().nullable(),
    construction: extensionConstruction,
    realEstate: extensionRealEstate,
  });

export type SubmitLeadBody = z.infer<typeof submitLeadBodySchema>;

export function createSubmitLeadService(leadRepo: LeadRepo) {
  return {
    async submit(
      site: SiteRow,
      body: SubmitLeadBody,
      meta: { ipHash?: string; userAgentTruncated?: string },
    ) {
      return leadRepo.create({
        organizationId: site.organizationId,
        siteId: site.id,
        clientId: body.clientId,
        industryVertical: body.industryVertical,
        sourceSystem: body.sourceSystem,
        sourceUrl: body.sourceUrl,
        landingPath: body.landingPath,
        utmSource: body.utmSource,
        utmMedium: body.utmMedium,
        utmCampaign: body.utmCampaign,
        utmTerm: body.utmTerm,
        utmContent: body.utmContent,
        formId: body.formId,
        campaignId: body.campaignId,
        submittedAt: body.submittedAt,
        ipHash: meta.ipHash ?? null,
        userAgentTruncated: meta.userAgentTruncated ?? null,
        email: body.email,
        phone: body.phone,
        fullName: body.fullName,
        message: body.message,
        construction: body.construction ?? undefined,
        realEstate: body.realEstate ?? undefined,
      });
    },
  };
}
