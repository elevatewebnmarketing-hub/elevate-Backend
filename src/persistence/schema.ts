import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/** @deprecated use domain/constants INDUSTRY_VERTICALS */
export const industryVerticalEnum = [
  "construction",
  "real_estate",
  "ngo",
  "hospital",
  "marketing",
  "other",
] as const;

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("organizations_slug_uidx").on(t.slug)],
);

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull(),
    label: text("label").notNull(),
    allowedOrigins: text("allowed_origins").array(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("sites_key_hash_uidx").on(t.keyHash),
    index("sites_org_idx").on(t.organizationId),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("org_viewer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("users_org_email_uidx").on(t.organizationId, t.email),
    index("users_org_idx").on(t.organizationId),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    clientId: text("client_id"),
    industryVertical: text("industry_vertical").notNull(),
    sourceSystem: text("source_system").notNull(),
    sourceUrl: text("source_url"),
    landingPath: text("landing_path"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmTerm: text("utm_term"),
    utmContent: text("utm_content"),
    formId: text("form_id").notNull(),
    campaignId: text("campaign_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ipHash: text("ip_hash"),
    userAgentTruncated: text("user_agent_truncated"),
    email: text("email").notNull(),
    phone: text("phone"),
    fullName: text("full_name").notNull(),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("leads_org_submitted_idx").on(t.organizationId, t.submittedAt)],
);

export const leadConstruction = pgTable("lead_construction", {
  leadId: uuid("lead_id")
    .primaryKey()
    .references(() => leads.id, { onDelete: "cascade" }),
  projectType: text("project_type"),
  timeline: text("timeline"),
  budgetRange: text("budget_range"),
});

export const leadRealEstate = pgTable("lead_real_estate", {
  leadId: uuid("lead_id")
    .primaryKey()
    .references(() => leads.id, { onDelete: "cascade" }),
  propertyInterest: text("property_interest"),
  locationPreference: text("location_preference"),
  bedrooms: text("bedrooms"),
});

/** Uploaded media references (Cloudinary) for blogs/hiring/property cards. */
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    cloudinaryPublicId: text("cloudinary_public_id").notNull(),
    cloudinaryResourceType: text("cloudinary_resource_type").notNull(),
    secureUrl: text("secure_url").notNull(),
    bytes: text("bytes"),
    width: text("width"),
    height: text("height"),
    durationSeconds: text("duration_seconds"),
    format: text("format"),
    folder: text("folder"),
    title: text("title"),
    purpose: text("purpose"),
    tags: text("tags").array(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("media_assets_cloudinary_public_id_uidx").on(t.cloudinaryPublicId),
    index("media_assets_org_created_idx").on(t.organizationId, t.createdAt),
    index("media_assets_uploaded_by_idx").on(t.uploadedByUserId),
  ],
);

/** Platform operators (separate from org-scoped `users`). */
export const superAdmins = pgTable(
  "super_admins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("super_admins_email_uidx").on(t.email)],
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  sites: many(sites),
  users: many(users),
  leads: many(leads),
  mediaAssets: many(mediaAssets),
}));

export const sitesRelations = relations(sites, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [sites.organizationId],
    references: [organizations.id],
  }),
  leads: many(leads),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  mediaAssets: many(mediaAssets),
}));

export const leadsRelations = relations(leads, ({ one }) => ({
  organization: one(organizations, {
    fields: [leads.organizationId],
    references: [organizations.id],
  }),
  site: one(sites, {
    fields: [leads.siteId],
    references: [sites.id],
  }),
  construction: one(leadConstruction, {
    fields: [leads.id],
    references: [leadConstruction.leadId],
  }),
  realEstate: one(leadRealEstate, {
    fields: [leads.id],
    references: [leadRealEstate.leadId],
  }),
}));

export const leadConstructionRelations = relations(leadConstruction, ({ one }) => ({
  lead: one(leads, {
    fields: [leadConstruction.leadId],
    references: [leads.id],
  }),
}));

export const leadRealEstateRelations = relations(leadRealEstate, ({ one }) => ({
  lead: one(leads, {
    fields: [leadRealEstate.leadId],
    references: [leads.id],
  }),
}));

export const mediaAssetsRelations = relations(mediaAssets, ({ one }) => ({
  organization: one(organizations, {
    fields: [mediaAssets.organizationId],
    references: [organizations.id],
  }),
  uploadedByUser: one(users, {
    fields: [mediaAssets.uploadedByUserId],
    references: [users.id],
  }),
}));
