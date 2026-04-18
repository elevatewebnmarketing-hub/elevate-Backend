import { Resend } from "resend";
import type { Env } from "../config/env.js";
import type { LeadWithExtensions } from "../persistence/repositories/lead.repository.js";

const RESEND_TEST_FROM = "Elevate <onboarding@resend.dev>";

export function isResendConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim());
}

export function getResendDefaultFrom(env: Env): string {
  return env.RESEND_FROM?.trim() || RESEND_TEST_FROM;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cell(v: string | null | undefined): string {
  if (v == null || v === "") return "—";
  return escapeHtml(String(v));
}

/**
 * Send a one-off test message (e.g. from POST /v1/admin/email/test).
 * Requires RESEND_API_KEY. Use a verified `RESEND_FROM` in production.
 */
export async function sendTestEmail(
  env: Env,
  to: string,
): Promise<{ id: string | undefined }> {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  const resend = new Resend(key);
  const from = getResendDefaultFrom(env);
  const result = await resend.emails.send({
    from,
    to,
    subject: "Elevate API — test email",
    html: "<p>If you received this, <strong>Resend</strong> is configured correctly.</p>",
  });
  if (result.error) {
    throw new Error(result.error.message);
  }
  return { id: result.data?.id };
}

export type LeadNotificationContext = {
  organizationName: string;
  siteLabel: string;
  lead: LeadWithExtensions;
};

/**
 * HTML notification for a new lead. Subject and body highlight org + site so
 * recipients can confirm tenant context.
 */
export async function sendLeadNotificationEmail(
  env: Env,
  to: string,
  ctx: LeadNotificationContext,
): Promise<{ id: string | undefined }> {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  const { lead, organizationName, siteLabel } = ctx;
  const subject = `New lead — ${organizationName} — ${siteLabel} — ${lead.id.slice(0, 8)}`;

  const rows: [string, string][] = [
    ["Organization", organizationName],
    ["Site", siteLabel],
    ["Lead ID", lead.id],
    ["Submitted (UTC)", lead.submittedAt.toISOString()],
    ["Full name", lead.fullName],
    ["Email", lead.email],
    ["Phone", lead.phone ?? ""],
    ["Industry", lead.industryVertical],
    ["Form ID", lead.formId],
    ["Source system", lead.sourceSystem],
    ["Message", lead.message ?? ""],
    ["Source URL", lead.sourceUrl ?? ""],
    ["Landing path", lead.landingPath ?? ""],
    ["UTM source", lead.utmSource ?? ""],
    ["UTM medium", lead.utmMedium ?? ""],
    ["UTM campaign", lead.utmCampaign ?? ""],
    ["UTM term", lead.utmTerm ?? ""],
    ["UTM content", lead.utmContent ?? ""],
    ["Campaign ID", lead.campaignId ?? ""],
    ["Client ID", lead.clientId ?? ""],
  ];

  if (lead.construction) {
    rows.push(
      ["Construction — project type", lead.construction.projectType ?? ""],
      ["Construction — timeline", lead.construction.timeline ?? ""],
      ["Construction — budget", lead.construction.budgetRange ?? ""],
    );
  }
  if (lead.realEstate) {
    rows.push(
      ["Real estate — property interest", lead.realEstate.propertyInterest ?? ""],
      ["Real estate — location", lead.realEstate.locationPreference ?? ""],
      ["Real estate — bedrooms", lead.realEstate.bedrooms ?? ""],
    );
  }

  const tableRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;width:200px;">${escapeHtml(k)}</td><td style="padding:8px;border:1px solid #ddd;">${cell(v)}</td></tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
<h1 style="margin:0 0 8px;">New lead</h1>
<p style="margin:0 0 16px;font-size:16px;"><strong>${escapeHtml(organizationName)}</strong> · ${escapeHtml(siteLabel)}</p>
<table style="border-collapse:collapse;width:100%;max-width:720px;">${tableRows}</table>
<p style="margin-top:16px;font-size:12px;color:#666;">This message was sent by the Elevate API when a visitor submitted your lead form.</p>
</body></html>`;

  const resend = new Resend(key);
  const from = getResendDefaultFrom(env);
  const result = await resend.emails.send({
    from,
    to,
    subject,
    html,
  });
  if (result.error) {
    throw new Error(result.error.message);
  }
  return { id: result.data?.id };
}
