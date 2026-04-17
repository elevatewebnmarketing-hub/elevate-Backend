import { Resend } from "resend";
import type { Env } from "../config/env.js";

const RESEND_TEST_FROM = "Elevate <onboarding@resend.dev>";

export function isResendConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim());
}

export function getResendDefaultFrom(env: Env): string {
  return env.RESEND_FROM?.trim() || RESEND_TEST_FROM;
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
