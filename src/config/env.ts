import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  SITE_KEY_PEPPER: z.string().min(16),
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s.split(",").map((x) => x.trim()).filter(Boolean)
        : ["*"],
    ),
  /**
   * When true, Fastify trusts `X-Forwarded-*` from the reverse proxy (needed for correct client IP behind CDN/LB).
   * Set `TRUST_PROXY=true` in production when the API sits behind nginx/Cloudflare/Render/etc.
   */
  TRUST_PROXY: z
    .preprocess(
      (v) => v === "true" || v === "1" || v === true || v === 1,
      z.boolean(),
    )
    .default(false),
  /** Stricter limits for credential login endpoints (per IP). */
  AUTH_LOGIN_RATE_MAX: z.coerce.number().int().positive().default(20),
  AUTH_LOGIN_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /**
   * When false (default), `GET /v1/openapi.json` returns 404 in production.
   * Set true only if you intentionally expose the OpenAPI document publicly.
   */
  OPENAPI_PUBLIC_IN_PRODUCTION: z
    .preprocess(
      (v) => v === "true" || v === "1" || v === true || v === 1,
      z.boolean(),
    )
    .default(false),
  RATE_LIMIT_MAX: z.coerce.number().default(60),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  /** Resend API key — optional; when set, transactional email is enabled. */
  RESEND_API_KEY: z.string().optional(),
  /**
   * Verified sender, e.g. `Acme <notifications@yourdomain.com>`.
   * If unset but RESEND_API_KEY is set, defaults to Resend test sender (see integrations/resend.ts).
   */
  RESEND_FROM: z.string().optional(),
  /** Separate from org JWT — required for super-admin API + console. */
  SUPER_ADMIN_JWT_SECRET: z.string().min(32),
  SUPER_ADMIN_ACCESS_EXPIRES_IN: z.string().default("8h"),
  /**
   * If set and `super_admins` is empty, seed script can create the first row.
   * Remove from production env after first login.
   */
  SUPER_ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
  SUPER_ADMIN_BOOTSTRAP_PASSWORD: z.string().min(12).optional(),
  /** Comma-separated IPs allowed to call /v1/super-admin/* — empty = allow all. */
  SUPER_ADMIN_ALLOWED_IPS: z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s.split(",").map((x) => x.trim()).filter(Boolean)
        : [],
    ),
})
  .superRefine((data, ctx) => {
    const set = [
      data.CLOUDINARY_CLOUD_NAME,
      data.CLOUDINARY_API_KEY,
      data.CLOUDINARY_API_SECRET,
    ].filter(Boolean).length;
    if (set !== 0 && set !== 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Set all of CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, or omit all to disable Cloudinary.",
        path: ["CLOUDINARY_CLOUD_NAME"],
      });
    }
    const bootEmail = Boolean(data.SUPER_ADMIN_BOOTSTRAP_EMAIL);
    const bootPass = Boolean(data.SUPER_ADMIN_BOOTSTRAP_PASSWORD);
    if (bootEmail !== bootPass) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Set both SUPER_ADMIN_BOOTSTRAP_EMAIL and SUPER_ADMIN_BOOTSTRAP_PASSWORD, or neither.",
        path: ["SUPER_ADMIN_BOOTSTRAP_EMAIL"],
      });
    }
    if (data.NODE_ENV === "production" && data.CORS_ORIGINS.includes("*")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "CORS_ORIGINS cannot be '*' in production. Set a comma-separated list of exact origins (e.g. https://backend.example.com).",
        path: ["CORS_ORIGINS"],
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export type CloudinaryCredentials = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

export function getCloudinaryCredentials(env: Env): CloudinaryCredentials | null {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = env;
  if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
    return {
      cloudName: CLOUDINARY_CLOUD_NAME,
      apiKey: CLOUDINARY_API_KEY,
      apiSecret: CLOUDINARY_API_SECRET,
    };
  }
  return null;
}

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(msg)}`);
  }
  return parsed.data;
}
