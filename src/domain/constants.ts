export const INDUSTRY_VERTICALS = [
  "construction",
  "real_estate",
  "ngo",
  "hospital",
  "marketing",
  "other",
] as const;

export type IndustryVertical = (typeof INDUSTRY_VERTICALS)[number];

export type UserRole = "org_admin" | "org_viewer";
