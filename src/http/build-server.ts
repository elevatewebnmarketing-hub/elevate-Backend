import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyRequest } from "fastify";
import { z } from "zod";
import { getCloudinaryCredentials, type Env } from "../config/env.js";
import {
  createAuthService,
  loginBodySchema,
} from "../application/auth.service.js";
import { createListLeadsService } from "../application/list-leads.service.js";
import { createSubmitLeadService, submitLeadBodySchema } from "../application/submit-lead.service.js";
import { createDb } from "../persistence/db.js";
import { hashIp, hashSiteKey } from "../persistence/site-key.js";
import {
  createBlogPostRepository,
  type BlogPostRow,
  type BlogPostWithCover,
} from "../persistence/repositories/blog-post.repository.js";
import {
  createHiringPositionRepository,
  type HiringPositionRow,
} from "../persistence/repositories/hiring-position.repository.js";
import { createLeadRepository } from "../persistence/repositories/lead.repository.js";
import { createMediaAssetRepository } from "../persistence/repositories/media-asset.repository.js";
import { createOrganizationRepository } from "../persistence/repositories/organization.repository.js";
import {
  createPortfolioProjectRepository,
  type PortfolioProjectRow,
  type PortfolioProjectWithImage,
} from "../persistence/repositories/portfolio-project.repository.js";
import { createSiteRepository } from "../persistence/repositories/site.repository.js";
import { createUserRepository } from "../persistence/repositories/user.repository.js";
import {
  configureCloudinary,
  createSignedUploadParams,
} from "../integrations/cloudinary.js";
import {
  isResendConfigured,
  sendLeadNotificationEmail,
  sendTestEmail,
} from "../integrations/resend.js";
import { registerErrorHandler } from "./error-handler.js";
import { registerSuperAdminRoutes } from "./super-admin.routes.js";

const cloudinaryUploadBodySchema = z.object({
  context: z.string().max(120).optional(),
  tags: z.array(z.string().min(1).max(60)).max(8).optional(),
  resourceType: z.enum(["image", "video"]).default("image"),
});

const cloudinaryAssetBodySchema = z.object({
  publicId: z.string().min(1),
  secureUrl: z.string().url(),
  resourceType: z.enum(["image", "video"]),
  bytes: z.union([z.string(), z.number()]).optional().nullable(),
  width: z.union([z.string(), z.number()]).optional().nullable(),
  height: z.union([z.string(), z.number()]).optional().nullable(),
  durationSeconds: z.union([z.string(), z.number()]).optional().nullable(),
  format: z.string().optional().nullable(),
  folder: z.string().optional().nullable(),
  title: z.string().max(200).optional().nullable(),
  purpose: z.string().max(120).optional().nullable(),
  tags: z.array(z.string().min(1).max(60)).max(20).optional().nullable(),
});

const cloudinaryAssetListQuerySchema = z.object({
  q: z.string().optional(),
  resourceType: z.enum(["image", "video"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const emailTestBodySchema = z.object({
  to: z.string().email(),
});

const patchOrgNotificationSchema = z.object({
  leadsNotificationEmail: z.union([z.string().email().max(320), z.null()]),
});

const patchSiteNotificationSchema = z.object({
  leadsNotificationEmail: z.union([z.string().email().max(320), z.null()]),
});

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const blogStatusSchema = z.enum(["draft", "published"]);

const createBlogPostBodySchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1).max(500),
  excerpt: z.string().max(5000).optional().nullable(),
  body: z.string().min(1).max(500_000),
  status: blogStatusSchema,
  publishedAt: z.coerce.date().optional().nullable(),
  coverMediaAssetId: z.string().uuid().optional().nullable(),
});

const patchBlogPostBodySchema = createBlogPostBodySchema.partial();

const createHiringBodySchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(50_000),
  location: z.string().max(500).optional().nullable(),
  applicationUrl: z.string().url().max(2000).optional().nullable(),
  isPublished: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const patchHiringBodySchema = createHiringBodySchema.partial();

const createPortfolioBodySchema = z.object({
  title: z.string().min(1).max(500),
  summary: z.string().max(5000).optional().nullable(),
  body: z.string().max(500_000).optional().nullable(),
  imageMediaAssetId: z.string().uuid().optional().nullable(),
  isPublished: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const patchPortfolioBodySchema = createPortfolioBodySchema.partial();

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

function getSiteKeyFromRequest(req: FastifyRequest): string | undefined {
  const h = req.headers["x-site-key"];
  if (typeof h === "string" && h) return h.trim();
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return undefined;
}

function clientIp(req: FastifyRequest): string | undefined {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf) return xf.split(",")[0]?.trim();
  return req.ip;
}

function truncateUa(ua: string | undefined): string | undefined {
  if (!ua) return undefined;
  return ua.length > 512 ? ua.slice(0, 512) : ua;
}

export async function buildServer(env: Env) {
  const { db, client } = createDb(env);

  const siteRepo = createSiteRepository(db);
  const leadRepo = createLeadRepository(db);
  const mediaAssetRepo = createMediaAssetRepository(db);
  const orgRepo = createOrganizationRepository(db);
  const blogPostRepo = createBlogPostRepository(db);
  const hiringRepo = createHiringPositionRepository(db);
  const portfolioRepo = createPortfolioProjectRepository(db);
  const userRepo = createUserRepository(db);
  const submitLead = createSubmitLeadService(leadRepo);
  const listLeads = createListLeadsService(leadRepo);
  const authService = createAuthService(userRepo);

  const app = Fastify({
    trustProxy: env.TRUST_PROXY,
    logger:
      env.NODE_ENV === "development"
        ? {
            transport: {
              target: "pino-pretty",
              options: { colorize: true },
            },
          }
        : true,
  });

  registerErrorHandler(app);

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  /** Per-route limits (e.g. login) when `config.rateLimit` is set */
  await app.register(rateLimit, {
    global: false,
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }
      if (env.CORS_ORIGINS.includes("*")) {
        cb(null, true);
        return;
      }
      if (env.CORS_ORIGINS.includes(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_EXPIRES_IN },
  });

  await app.register(jwt, {
    secret: env.SUPER_ADMIN_JWT_SECRET,
    namespace: "superAdmin",
    sign: { expiresIn: env.SUPER_ADMIN_ACCESS_EXPIRES_IN },
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Elevate Central API",
        version: "1.0.0",
        description:
          "Multi-tenant REST API for lead capture and admin. Versioned under `/v1`.",
      },
      servers: [{ url: "/" }],
      tags: [
        { name: "health", description: "Health checks" },
        {
          name: "public",
          description:
            "Public endpoints (site-key lead submit; org slug content reads)",
        },
        { name: "auth", description: "Staff authentication" },
        {
          name: "admin",
          description:
            "JWT + organization-scoped admin (leads, sites, blog, hiring, portfolio)",
        },
        {
          name: "integrations",
          description: "Optional third-party helpers (Cloudinary, Resend, etc.)",
        },
        {
          name: "super-admin",
          description:
            "Platform super-admin (separate JWT from org staff; POST /v1/super-admin/auth/login)",
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
          superAdminBearer: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description:
              "Super admin access token from POST /v1/super-admin/auth/login",
          },
          siteKey: {
            type: "apiKey",
            in: "header",
            name: "X-Site-Key",
          },
        },
      },
    },
  });

  // In production, rely on OpenAPI JSON or restrict docs at the reverse proxy.
  if (env.NODE_ENV !== "production") {
    // Nest under `/v1` with `routePrefix: /docs` so static assets resolve at `/v1/docs/static/*`
    // (a single `routePrefix: /v1/docs` breaks @fastify/swagger-ui static file routes on some setups).
    await app.register(
      async (child) => {
        await child.register(swaggerUi, {
          routePrefix: "/docs",
          uiConfig: { docExpansion: "list", deepLinking: true },
        });
      },
      { prefix: "/v1" },
    );
  }

  if (
    env.NODE_ENV !== "production" ||
    env.OPENAPI_PUBLIC_IN_PRODUCTION
  ) {
    app.get("/v1/openapi.json", async (_req, reply) => {
      return reply.send(app.swagger());
    });
  }

  app.get(
    "/v1/health",
    {
      schema: {
        tags: ["health"],
        summary:
          "Liveness check; returns JSON (if the tab looks empty, view source or open in curl)",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              service: { type: "string" },
              apiVersion: { type: "string" },
              time: { type: "string", format: "date-time" },
              uptimeSeconds: { type: "number" },
              integrations: {
                type: "object",
                description: "Whether optional services are configured (no secrets exposed)",
                properties: {
                  cloudinary: { type: "boolean" },
                  email: { type: "boolean" },
                },
              },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      const body = {
        status: "ok" as const,
        service: "elevate-backend",
        apiVersion: "v1",
        time: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        integrations: {
          cloudinary: Boolean(getCloudinaryCredentials(env)),
          email: isResendConfigured(env),
        },
      };
      return reply.type("application/json; charset=utf-8").send(body);
    },
  );

  await app.register(
    async (scope) => {
      await scope.register(rateLimit, {
        max: env.RATE_LIMIT_MAX,
        timeWindow: env.RATE_LIMIT_WINDOW_MS,
        keyGenerator: (req) => {
          const key = getSiteKeyFromRequest(req) ?? "anon";
          const ip = clientIp(req) ?? "unknown";
          return `${hashSiteKey(key, env.SITE_KEY_PEPPER).slice(0, 16)}:${ip}`;
        },
      });

      scope.post(
        "/leads",
        {
          schema: {
            tags: ["public"],
            summary: "Submit a lead (publishable site key)",
            security: [{ siteKey: [] }],
            description:
              "Authenticate with header `X-Site-Key` or `Authorization: Bearer <publishable_key>`.",
            body: {
              type: "object",
              required: [
                "industryVertical",
                "sourceSystem",
                "formId",
                "email",
                "fullName",
              ],
              properties: {
                industryVertical: { type: "string" },
                clientId: { type: "string", nullable: true },
                sourceSystem: { type: "string" },
                sourceUrl: { type: "string", nullable: true },
                landingPath: { type: "string", nullable: true },
                utmSource: { type: "string", nullable: true },
                utmMedium: { type: "string", nullable: true },
                utmCampaign: { type: "string", nullable: true },
                utmTerm: { type: "string", nullable: true },
                utmContent: { type: "string", nullable: true },
                formId: { type: "string" },
                campaignId: { type: "string", nullable: true },
                submittedAt: { type: "string", format: "date-time", nullable: true },
                email: { type: "string", format: "email" },
                phone: { type: "string", nullable: true },
                fullName: { type: "string" },
                message: { type: "string", nullable: true },
                construction: { type: "object", nullable: true },
                realEstate: { type: "object", nullable: true },
              },
            },
          },
          preHandler: async (req, reply) => {
            const raw = getSiteKeyFromRequest(req);
            if (!raw) {
              return reply.status(401).send({ error: "missing_site_key" });
            }
            const keyHash = hashSiteKey(raw, env.SITE_KEY_PEPPER);
            const site = await siteRepo.findByKeyHash(keyHash);
            if (!site || !site.isActive) {
              return reply.status(401).send({ error: "invalid_site_key" });
            }
            const origin = req.headers.origin;
            if (site.allowedOrigins?.length) {
              if (!origin || !site.allowedOrigins.includes(origin)) {
                return reply.status(403).send({ error: "origin_not_allowed" });
              }
            }
            req.site = site;
          },
        },
        async (req, reply) => {
          const parsed = submitLeadBodySchema.safeParse(req.body);
          if (!parsed.success) {
            return reply.status(400).send({
              error: "validation_error",
              details: parsed.error.flatten(),
            });
          }
          const site = req.site;
          if (!site) {
            return reply.status(500).send({ error: "site_context_missing" });
          }
          const lead = await submitLead.submit(site, parsed.data, {
            ipHash: hashIp(clientIp(req), env.SITE_KEY_PEPPER),
            userAgentTruncated: truncateUa(req.headers["user-agent"]),
          });

          if (isResendConfigured(env)) {
            const fullLead = await leadRepo.getByIdForOrganization(
              site.organizationId,
              lead.id,
            );
            const org = await orgRepo.findById(site.organizationId);
            const to =
              site.leadsNotificationEmail?.trim() ||
              org?.leadsNotificationEmail?.trim() ||
              "";
            if (fullLead && to && org) {
              void sendLeadNotificationEmail(env, to, {
                organizationName: org.name,
                siteLabel: site.label,
                lead: fullLead,
              }).catch((err) => {
                req.log.warn(
                  { err },
                  "lead_notification_email_failed",
                );
              });
            }
          }

          return reply.status(201).send({
            id: lead.id,
            organizationId: lead.organizationId,
            siteId: lead.siteId,
            submittedAt: lead.submittedAt.toISOString(),
          });
        },
      );
    },
    { prefix: "/v1/public" },
  );

  await app.register(
    async (scope) => {
      await scope.register(rateLimit, {
        max: env.RATE_LIMIT_MAX,
        timeWindow: env.RATE_LIMIT_WINDOW_MS,
        keyGenerator: (req) => {
          const ip = clientIp(req) ?? "unknown";
          return `public_org:${ip}`;
        },
      });

      async function orgFromSlug(slug: string) {
        const org = await orgRepo.findBySlug(slug);
        return org;
      }

      scope.get(
        "/org/:slug/blog-posts",
        {
          schema: {
            tags: ["public"],
            summary: "List published blog posts for an organization (by slug)",
            params: {
              type: "object",
              required: ["slug"],
              properties: { slug: { type: "string" } },
            },
            querystring: {
              type: "object",
              properties: {
                limit: { type: "integer", minimum: 1, maximum: 100 },
                offset: { type: "integer", minimum: 0 },
              },
            },
          },
        },
        async (req, reply) => {
          const { slug } = req.params as { slug: string };
          const pq = paginationQuerySchema.safeParse(req.query ?? {});
          if (!pq.success) {
            return reply.status(400).send({
              error: "validation_error",
              details: pq.error.flatten(),
            });
          }
          const org = await orgFromSlug(slug);
          if (!org) {
            return reply.status(404).send({ error: "not_found" });
          }
          const limit = pq.data.limit ?? 20;
          const offset = pq.data.offset ?? 0;
          const [items, total] = await Promise.all([
            blogPostRepo.listPublishedPublic(org.id, { limit, offset }),
            blogPostRepo.countPublishedPublic(org.id),
          ]);
          return reply.send({
            items: items.map(mapPublicBlogPost),
            total,
            limit,
            offset,
          });
        },
      );

      scope.get(
        "/org/:slug/blog-posts/:postSlug",
        {
          schema: {
            tags: ["public"],
            summary: "Get one published blog post",
            params: {
              type: "object",
              required: ["slug", "postSlug"],
              properties: {
                slug: { type: "string" },
                postSlug: { type: "string" },
              },
            },
          },
        },
        async (req, reply) => {
          const { slug, postSlug } = req.params as {
            slug: string;
            postSlug: string;
          };
          const org = await orgFromSlug(slug);
          if (!org) {
            return reply.status(404).send({ error: "not_found" });
          }
          const post = await blogPostRepo.getBySlugPublic(org.id, postSlug);
          if (!post) {
            return reply.status(404).send({ error: "not_found" });
          }
          return reply.send(mapPublicBlogPost(post));
        },
      );

      scope.get(
        "/org/:slug/hiring-positions",
        {
          schema: {
            tags: ["public"],
            summary: "List published hiring positions",
            params: {
              type: "object",
              required: ["slug"],
              properties: { slug: { type: "string" } },
            },
            querystring: {
              type: "object",
              properties: {
                limit: { type: "integer", minimum: 1, maximum: 100 },
                offset: { type: "integer", minimum: 0 },
              },
            },
          },
        },
        async (req, reply) => {
          const { slug } = req.params as { slug: string };
          const pq = paginationQuerySchema.safeParse(req.query ?? {});
          if (!pq.success) {
            return reply.status(400).send({
              error: "validation_error",
              details: pq.error.flatten(),
            });
          }
          const org = await orgFromSlug(slug);
          if (!org) {
            return reply.status(404).send({ error: "not_found" });
          }
          const limit = pq.data.limit ?? 50;
          const offset = pq.data.offset ?? 0;
          const [items, total] = await Promise.all([
            hiringRepo.listPublishedPublic(org.id, { limit, offset }),
            hiringRepo.countPublishedPublic(org.id),
          ]);
          return reply.send({
            items: items.map(mapHiring),
            total,
            limit,
            offset,
          });
        },
      );

      scope.get(
        "/org/:slug/portfolio-projects",
        {
          schema: {
            tags: ["public"],
            summary: "List published portfolio projects",
            params: {
              type: "object",
              required: ["slug"],
              properties: { slug: { type: "string" } },
            },
            querystring: {
              type: "object",
              properties: {
                limit: { type: "integer", minimum: 1, maximum: 100 },
                offset: { type: "integer", minimum: 0 },
              },
            },
          },
        },
        async (req, reply) => {
          const { slug } = req.params as { slug: string };
          const pq = paginationQuerySchema.safeParse(req.query ?? {});
          if (!pq.success) {
            return reply.status(400).send({
              error: "validation_error",
              details: pq.error.flatten(),
            });
          }
          const org = await orgFromSlug(slug);
          if (!org) {
            return reply.status(404).send({ error: "not_found" });
          }
          const limit = pq.data.limit ?? 50;
          const offset = pq.data.offset ?? 0;
          const [items, total] = await Promise.all([
            portfolioRepo.listPublishedPublic(org.id, { limit, offset }),
            portfolioRepo.countPublishedPublic(org.id),
          ]);
          return reply.send({
            items: items.map(mapPortfolioPublic),
            total,
            limit,
            offset,
          });
        },
      );
    },
    { prefix: "/v1/public" },
  );

  app.post(
    "/v1/auth/login",
    {
      config: {
        rateLimit: {
          max: env.AUTH_LOGIN_RATE_MAX,
          timeWindow: env.AUTH_LOGIN_RATE_WINDOW_MS,
        },
      },
      schema: {
        tags: ["auth"],
        summary: "Login (organization slug + email + password)",
        body: {
          type: "object",
          required: ["email", "password", "organizationSlug"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
            organizationSlug: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body as {
        email?: string;
        password?: string;
        organizationSlug?: string;
      };
      const parsed = loginBodySchema.safeParse(body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const session = await authService.verifyCredentials(parsed.data);
      if (!session) {
        return reply.status(401).send({ error: "invalid_credentials" });
      }
      const token = await reply.jwtSign({
        sub: session.userId,
        org_id: session.organizationId,
        role: session.role,
      });
      return reply.send({
        access_token: token,
        token_type: "Bearer",
        expires_in: env.JWT_ACCESS_EXPIRES_IN,
      });
    },
  );

  const authPre = async (req: FastifyRequest, reply: import("fastify").FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "unauthorized" });
    }
  };

  const authPreOrgAdmin = async (
    req: FastifyRequest,
    reply: import("fastify").FastifyReply,
  ) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (req.user.role !== "org_admin") {
      return reply
        .status(403)
        .send({ error: "forbidden", message: "org_admin role required" });
    }
  };

  app.get(
    "/v1/leads",
    {
      preHandler: authPre,
      schema: {
        tags: ["admin"],
        summary: "List leads for your organization",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            industryVertical: { type: "string" },
            sourceSystem: { type: "string" },
            campaignId: { type: "string" },
            q: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 100 },
            offset: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      const orgId = req.user.org_id;
      const q = req.query as Record<string, string | undefined>;
      const result = await listLeads.list(orgId, {
        from: q.from,
        to: q.to,
        industryVertical: q.industryVertical,
        sourceSystem: q.sourceSystem,
        campaignId: q.campaignId,
        q: q.q,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      });
      return reply.send({
        items: result.items.map(mapLead),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      });
    },
  );

  app.get(
    "/v1/leads/:id",
    {
      preHandler: authPre,
      schema: {
        tags: ["admin"],
        summary: "Get one lead with vertical extensions",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const orgId = req.user.org_id;
      const { id } = req.params as { id: string };
      const lead = await listLeads.getById(orgId, id);
      if (!lead) {
        return reply.status(404).send({ error: "not_found" });
      }
      return reply.send(mapLeadDetail(lead));
    },
  );

  app.get(
    "/v1/admin/organization",
    {
      preHandler: authPre,
      schema: {
        tags: ["admin"],
        summary: "Organization profile (notification fallback email)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (req, reply) => {
      const org = await orgRepo.findById(req.user.org_id);
      if (!org) {
        return reply.status(404).send({ error: "not_found" });
      }
      return reply.send({
        id: org.id,
        name: org.name,
        slug: org.slug,
        leadsNotificationEmail: org.leadsNotificationEmail,
      });
    },
  );

  app.patch(
    "/v1/admin/organization",
    {
      preHandler: authPreOrgAdmin,
      schema: {
        tags: ["admin"],
        summary: "Update organization-level lead notification email (fallback)",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            leadsNotificationEmail: { type: "string", format: "email", nullable: true },
          },
        },
      },
    },
    async (req, reply) => {
      const parsed = patchOrgNotificationSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const row = await orgRepo.updateLeadsNotificationEmail(
        req.user.org_id,
        parsed.data.leadsNotificationEmail,
      );
      if (!row) {
        return reply.status(404).send({ error: "not_found" });
      }
      return reply.send({
        id: row.id,
        name: row.name,
        slug: row.slug,
        leadsNotificationEmail: row.leadsNotificationEmail,
      });
    },
  );

  app.get(
    "/v1/admin/sites",
    {
      preHandler: authPre,
      schema: {
        tags: ["admin"],
        summary: "List sites for your organization (no secret keys)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (req, reply) => {
      const rows = await siteRepo.listByOrganizationId(req.user.org_id);
      return reply.send({
        items: rows.map((s) => ({
          id: s.id,
          label: s.label,
          isActive: s.isActive,
          leadsNotificationEmail: s.leadsNotificationEmail,
          createdAt: s.createdAt.toISOString(),
        })),
      });
    },
  );

  app.patch(
    "/v1/admin/sites/:siteId",
    {
      preHandler: authPreOrgAdmin,
      schema: {
        tags: ["admin"],
        summary: "Set per-site lead notification email (overrides org fallback)",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["siteId"],
          properties: { siteId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          properties: {
            leadsNotificationEmail: { type: "string", format: "email", nullable: true },
          },
        },
      },
    },
    async (req, reply) => {
      const { siteId } = req.params as { siteId: string };
      const parsed = patchSiteNotificationSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const row = await siteRepo.updateLeadsNotificationEmail(
        siteId,
        req.user.org_id,
        parsed.data.leadsNotificationEmail,
      );
      if (!row) {
        return reply.status(404).send({ error: "not_found" });
      }
      return reply.send({
        id: row.id,
        label: row.label,
        isActive: row.isActive,
        leadsNotificationEmail: row.leadsNotificationEmail,
      });
    },
  );

  app.get(
    "/v1/admin/blog-posts",
    {
      preHandler: authPre,
      schema: {
        tags: ["admin"],
        summary: "List blog posts (drafts and published)",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100 },
            offset: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      const pq = paginationQuerySchema.safeParse(req.query ?? {});
      if (!pq.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: pq.error.flatten(),
        });
      }
      const orgId = req.user.org_id;
      const limit = pq.data.limit ?? 50;
      const offset = pq.data.offset ?? 0;
      const [items, total] = await Promise.all([
        blogPostRepo.listForOrganization(orgId, { limit, offset }),
        blogPostRepo.countForOrganization(orgId),
      ]);
      return reply.send({
        items: items.map(mapBlogPostListItem),
        total,
        limit,
        offset,
      });
    },
  );

  app.post(
    "/v1/admin/blog-posts",
    {
      preHandler: authPreOrgAdmin,
      schema: {
        tags: ["admin"],
        summary: "Create a blog post",
        security: [{ bearerAuth: [] }],
      },
    },
    async (req, reply) => {
      const parsed = createBlogPostBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const orgId = req.user.org_id;
      const data = parsed.data;
      if (data.coverMediaAssetId) {
        const ok = await mediaAssetRepo.existsForOrganization(
          data.coverMediaAssetId,
          orgId,
        );
        if (!ok) {
          return reply.status(400).send({ error: "invalid_cover_media_asset" });
        }
      }
      let publishedAt: Date | null = data.publishedAt ?? null;
      if (data.status === "published") {
        publishedAt = publishedAt ?? new Date();
      } else {
        publishedAt = publishedAt ?? null;
      }
      try {
        const row = await blogPostRepo.create({
          organizationId: orgId,
          slug: data.slug,
          title: data.title,
          excerpt: data.excerpt ?? null,
          body: data.body,
          status: data.status,
          publishedAt,
          coverMediaAssetId: data.coverMediaAssetId ?? null,
        });
        const withCover = await blogPostRepo.getByIdWithCover(orgId, row.id);
        return reply
          .status(201)
          .send(withCover ? mapBlogPostDetail(withCover) : mapBlogPostListItem(row));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("unique") || msg.includes("duplicate")) {
          return reply.status(409).send({ error: "slug_taken" });
        }
        throw e;
      }
    },
  );

  app.get(
    "/v1/admin/blog-posts/:id",
    {
      preHandler: authPre,
      schema: {
        tags: ["admin"],
        summary: "Get one blog post",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = await blogPostRepo.getByIdWithCover(req.user.org_id, id);
      if (!row) {
        return reply.status(404).send({ error: "not_found" });
      }
      return reply.send(mapBlogPostDetail(row));
    },
  );

  app.patch(
    "/v1/admin/blog-posts/:id",
    {
      preHandler: authPreOrgAdmin,
      schema: {
        tags: ["admin"],
        summary: "Update a blog post",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = patchBlogPostBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const orgId = req.user.org_id;
      const patch = stripUndefined(parsed.data as Record<string, unknown>);
      if (patch.coverMediaAssetId) {
        const ok = await mediaAssetRepo.existsForOrganization(
          patch.coverMediaAssetId as string,
          orgId,
        );
        if (!ok) {
          return reply.status(400).send({ error: "invalid_cover_media_asset" });
        }
      }
      const existing = await blogPostRepo.getById(orgId, id);
      if (!existing) {
        return reply.status(404).send({ error: "not_found" });
      }
      const nextStatus = (patch.status as string | undefined) ?? existing.status;
      let newPublishedAt: Date | null;
      if (patch.publishedAt !== undefined) {
        newPublishedAt = patch.publishedAt as Date | null;
      } else if (nextStatus === "draft") {
        newPublishedAt = null;
      } else {
        newPublishedAt = existing.publishedAt ?? new Date();
      }
      const updatePayload = stripUndefined({
        ...patch,
        publishedAt: newPublishedAt,
      });
      try {
        const row = await blogPostRepo.update(orgId, id, updatePayload);
        if (!row) {
          return reply.status(404).send({ error: "not_found" });
        }
        const withCover = await blogPostRepo.getByIdWithCover(orgId, id);
        return reply.send(
          withCover ? mapBlogPostDetail(withCover) : mapBlogPostListItem(row),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("unique") || msg.includes("duplicate")) {
          return reply.status(409).send({ error: "slug_taken" });
        }
        throw e;
      }
    },
  );

  app.delete(
    "/v1/admin/blog-posts/:id",
    {
      preHandler: authPreOrgAdmin,
      schema: {
        tags: ["admin"],
        summary: "Delete a blog post",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const ok = await blogPostRepo.delete(req.user.org_id, id);
      if (!ok) {
        return reply.status(404).send({ error: "not_found" });
      }
      return reply.status(204).send();
    },
  );

  app.get(
    "/v1/admin/hiring-positions",
    {
      preHandler: authPre,
      schema: {
        tags: ["admin"],
        summary: "List hiring positions",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100 },
            offset: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      const pq = paginationQuerySchema.safeParse(req.query ?? {});
      if (!pq.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: pq.error.flatten(),
        });
      }
      const orgId = req.user.org_id;
      const limit = pq.data.limit ?? 100;
      const offset = pq.data.offset ?? 0;
      const [items, total] = await Promise.all([
        hiringRepo.listForOrganization(orgId, { limit, offset }),
        hiringRepo.countForOrganization(orgId),
      ]);
      return reply.send({
        items: items.map(mapHiring),
        total,
        limit,
        offset,
      });
    },
  );

  app.post(
    "/v1/admin/hiring-positions",
    {
      preHandler: authPreOrgAdmin,
      schema: {
        tags: ["admin"],
        summary: "Create a hiring position",
        security: [{ bearerAuth: [] }],
      },
    },
    async (req, reply) => {
      const parsed = createHiringBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const d = parsed.data;
      const row = await hiringRepo.create({
        organizationId: req.user.org_id,
        title: d.title,
        description: d.description,
        location: d.location ?? null,
        applicationUrl: d.applicationUrl ?? null,
        isPublished: d.isPublished ?? false,
        sortOrder: d.sortOrder ?? 0,
      });
      return reply.status(201).send(mapHiring(row));
    },
  );

  app.get(
    "/v1/admin/hiring-positions/:id",
    {
      preHandler: authPre,
      schema: {
        tags: ["admin"],
        summary: "Get one hiring position",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = await hiringRepo.getById(req.user.org_id, id);
      if (!row) {
        return reply.status(404).send({ error: "not_found" });
      }
      return reply.send(mapHiring(row));
    },
  );

  app.patch(
    "/v1/admin/hiring-positions/:id",
    {
      preHandler: authPreOrgAdmin,
      schema: {
        tags: ["admin"],
        summary: "Update a hiring position",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = patchHiringBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const patch = stripUndefined(parsed.data as Record<string, unknown>);
      const row = await hiringRepo.update(req.user.org_id, id, patch);
      if (!row) {
        return reply.status(404).send({ error: "not_found" });
      }
      return reply.send(mapHiring(row));
    },
  );

  app.delete(
    "/v1/admin/hiring-positions/:id",
    {
      preHandler: authPreOrgAdmin,
      schema: {
        tags: ["admin"],
        summary: "Delete a hiring position",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const ok = await hiringRepo.delete(req.user.org_id, id);
      if (!ok) {
        return reply.status(404).send({ error: "not_found" });
      }
      return reply.status(204).send();
    },
  );

  app.get(
    "/v1/admin/portfolio-projects",
    {
      preHandler: authPre,
      schema: {
        tags: ["admin"],
        summary: "List portfolio projects",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100 },
            offset: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      const pq = paginationQuerySchema.safeParse(req.query ?? {});
      if (!pq.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: pq.error.flatten(),
        });
      }
      const orgId = req.user.org_id;
      const limit = pq.data.limit ?? 100;
      const offset = pq.data.offset ?? 0;
      const [items, total] = await Promise.all([
        portfolioRepo.listForOrganization(orgId, { limit, offset }),
        portfolioRepo.countForOrganization(orgId),
      ]);
      return reply.send({
        items: items.map(mapPortfolioAdmin),
        total,
        limit,
        offset,
      });
    },
  );

  app.post(
    "/v1/admin/portfolio-projects",
    {
      preHandler: authPreOrgAdmin,
      schema: {
        tags: ["admin"],
        summary: "Create a portfolio project",
        security: [{ bearerAuth: [] }],
      },
    },
    async (req, reply) => {
      const parsed = createPortfolioBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const orgId = req.user.org_id;
      const d = parsed.data;
      if (d.imageMediaAssetId) {
        const ok = await mediaAssetRepo.existsForOrganization(
          d.imageMediaAssetId,
          orgId,
        );
        if (!ok) {
          return reply.status(400).send({ error: "invalid_image_media_asset" });
        }
      }
      const row = await portfolioRepo.create({
        organizationId: orgId,
        title: d.title,
        summary: d.summary ?? null,
        body: d.body ?? null,
        imageMediaAssetId: d.imageMediaAssetId ?? null,
        isPublished: d.isPublished ?? false,
        sortOrder: d.sortOrder ?? 0,
      });
      const withImg = await portfolioRepo.getByIdWithImage(orgId, row.id);
      return reply
        .status(201)
        .send(withImg ? mapPortfolioAdmin(withImg) : mapPortfolioRow(row));
    },
  );

  app.get(
    "/v1/admin/portfolio-projects/:id",
    {
      preHandler: authPre,
      schema: {
        tags: ["admin"],
        summary: "Get one portfolio project",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = await portfolioRepo.getByIdWithImage(req.user.org_id, id);
      if (!row) {
        return reply.status(404).send({ error: "not_found" });
      }
      return reply.send(mapPortfolioAdmin(row));
    },
  );

  app.patch(
    "/v1/admin/portfolio-projects/:id",
    {
      preHandler: authPreOrgAdmin,
      schema: {
        tags: ["admin"],
        summary: "Update a portfolio project",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = patchPortfolioBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const orgId = req.user.org_id;
      const patch = stripUndefined(parsed.data as Record<string, unknown>);
      if (patch.imageMediaAssetId) {
        const ok = await mediaAssetRepo.existsForOrganization(
          patch.imageMediaAssetId as string,
          orgId,
        );
        if (!ok) {
          return reply.status(400).send({ error: "invalid_image_media_asset" });
        }
      }
      const row = await portfolioRepo.update(orgId, id, patch);
      if (!row) {
        return reply.status(404).send({ error: "not_found" });
      }
      const withImg = await portfolioRepo.getByIdWithImage(orgId, id);
      return reply.send(
        withImg ? mapPortfolioAdmin(withImg) : mapPortfolioRow(row),
      );
    },
  );

  app.delete(
    "/v1/admin/portfolio-projects/:id",
    {
      preHandler: authPreOrgAdmin,
      schema: {
        tags: ["admin"],
        summary: "Delete a portfolio project",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const ok = await portfolioRepo.delete(req.user.org_id, id);
      if (!ok) {
        return reply.status(404).send({ error: "not_found" });
      }
      return reply.status(204).send();
    },
  );

  const cloudinaryCreds = getCloudinaryCredentials(env);
  if (cloudinaryCreds) {
    configureCloudinary(cloudinaryCreds);
    app.post(
      "/v1/admin/cloudinary/upload-signature",
      {
        preHandler: authPre,
        schema: {
          tags: ["integrations"],
          summary:
            "Signed upload params for direct upload to Cloudinary (scoped to your organization folder)",
          security: [{ bearerAuth: [] }],
          description:
            "Returns non-secret fields for a multipart POST to `uploadUrl`. Include the same `folder`, `timestamp`, `api_key` (as `apiKey`), and `signature` in the form. Never expose `CLOUDINARY_API_SECRET` to clients.",
          body: {
            type: "object",
            properties: {
              context: {
                type: "string",
                description: "Optional subfolder segment (sanitized server-side)",
              },
              resourceType: {
                type: "string",
                enum: ["image", "video"],
                default: "image",
              },
            },
          },
        },
      },
      async (req, reply) => {
        const parsed = cloudinaryUploadBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return reply.status(400).send({
            error: "validation_error",
            details: parsed.error.flatten(),
          });
        }
        const orgId = req.user.org_id;
        const uploaderTag = `user_${req.user.sub.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
        const params = createSignedUploadParams(cloudinaryCreds, {
          organizationId: orgId,
          uploaderTag,
          extraTags: parsed.data.tags,
          context: parsed.data.context,
          resourceType: parsed.data.resourceType,
        });
        return reply.send({
          cloudName: params.cloudName,
          apiKey: params.apiKey,
          timestamp: params.timestamp,
          signature: params.signature,
          folder: params.folder,
          tags: params.tags,
          resourceType: params.resourceType,
          uploadUrl: params.uploadUrl,
        });
      },
    );

    app.post(
      "/v1/admin/cloudinary/assets",
      {
        preHandler: authPre,
        schema: {
          tags: ["integrations"],
          summary: "Register uploaded Cloudinary asset metadata for organization media library",
          security: [{ bearerAuth: [] }],
          body: {
            type: "object",
            required: ["publicId", "secureUrl", "resourceType"],
            properties: {
              publicId: { type: "string" },
              secureUrl: { type: "string", format: "uri" },
              resourceType: { type: "string", enum: ["image", "video"] },
              bytes: { type: ["string", "number"], nullable: true },
              width: { type: ["string", "number"], nullable: true },
              height: { type: ["string", "number"], nullable: true },
              durationSeconds: { type: ["string", "number"], nullable: true },
              format: { type: "string", nullable: true },
              folder: { type: "string", nullable: true },
              title: { type: "string", nullable: true },
              purpose: { type: "string", nullable: true },
              tags: { type: "array", items: { type: "string" }, nullable: true },
            },
          },
        },
      },
      async (req, reply) => {
        const parsed = cloudinaryAssetBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return reply.status(400).send({
            error: "validation_error",
            details: parsed.error.flatten(),
          });
        }
        const orgId = req.user.org_id;
        const userId = req.user.sub;
        const data = parsed.data;
        const normalizedTags = [
          ...(data.tags ?? []),
          `org_${orgId.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
          `user_${userId.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
        ]
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 20);

        const row = await mediaAssetRepo.create({
          organizationId: orgId,
          uploadedByUserId: userId,
          cloudinaryPublicId: data.publicId,
          cloudinaryResourceType: data.resourceType,
          secureUrl: data.secureUrl,
          bytes: data.bytes != null ? String(data.bytes) : null,
          width: data.width != null ? String(data.width) : null,
          height: data.height != null ? String(data.height) : null,
          durationSeconds:
            data.durationSeconds != null ? String(data.durationSeconds) : null,
          format: data.format ?? null,
          folder: data.folder ?? null,
          title: data.title ?? null,
          purpose: data.purpose ?? null,
          tags: normalizedTags,
        });
        return reply.status(201).send(row);
      },
    );

    app.get(
      "/v1/admin/cloudinary/assets",
      {
        preHandler: authPre,
        schema: {
          tags: ["integrations"],
          summary: "List your organization media assets uploaded to Cloudinary",
          security: [{ bearerAuth: [] }],
          querystring: {
            type: "object",
            properties: {
              q: { type: "string" },
              resourceType: { type: "string", enum: ["image", "video"] },
              limit: { type: "integer", minimum: 1, maximum: 200 },
              offset: { type: "integer", minimum: 0 },
            },
          },
        },
      },
      async (req, reply) => {
        const parsed = cloudinaryAssetListQuerySchema.safeParse(req.query ?? {});
        if (!parsed.success) {
          return reply.status(400).send({
            error: "validation_error",
            details: parsed.error.flatten(),
          });
        }
        const q = parsed.data;
        const result = await mediaAssetRepo.listForOrganization(req.user.org_id, {
          q: q.q,
          resourceType: q.resourceType,
          limit: q.limit ?? 50,
          offset: q.offset ?? 0,
        });
        return reply.send({
          items: result.items.map((x) => ({
            ...x.asset,
            uploaderEmail: x.uploaderEmail,
          })),
          total: result.total,
          limit: q.limit ?? 50,
          offset: q.offset ?? 0,
        });
      },
    );
  }

  app.post(
    "/v1/admin/email/test",
    {
      preHandler: authPreOrgAdmin,
      schema: {
        tags: ["integrations"],
        summary:
          "Send a test email via Resend (requires org_admin; verify domain / from-address in Resend for production). Returns 503 when RESEND_API_KEY is not set.",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["to"],
          properties: {
            to: { type: "string", format: "email" },
          },
        },
      },
    },
    async (req, reply) => {
      if (!isResendConfigured(env)) {
        return reply.status(503).send({
          error: "email_not_configured",
          message:
            "Transactional email is not enabled on this server (set RESEND_API_KEY).",
          hint: "Lead notification recipients can still be saved; delivery requires Resend on the API host.",
        });
      }
      const parsed = emailTestBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      try {
        const result = await sendTestEmail(env, parsed.data.to);
        return reply.send({ ok: true, messageId: result.id ?? null });
      } catch (err) {
        app.log.error(err);
        return reply.status(502).send({
          error: "email_send_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  await registerSuperAdminRoutes(app, { env, db });

  app.addHook("onClose", async () => {
    await client.end({ timeout: 5 });
  });

  return { app, sqlClient: client };
}

function mapLead(lead: {
  id: string;
  organizationId: string;
  siteId: string;
  clientId: string | null;
  industryVertical: string;
  sourceSystem: string;
  sourceUrl: string | null;
  landingPath: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  formId: string;
  campaignId: string | null;
  submittedAt: Date;
  ipHash: string | null;
  userAgentTruncated: string | null;
  email: string;
  phone: string | null;
  fullName: string;
  message: string | null;
  createdAt: Date;
}) {
  return {
    id: lead.id,
    organizationId: lead.organizationId,
    siteId: lead.siteId,
    clientId: lead.clientId,
    industryVertical: lead.industryVertical,
    sourceSystem: lead.sourceSystem,
    sourceUrl: lead.sourceUrl,
    landingPath: lead.landingPath,
    utmSource: lead.utmSource,
    utmMedium: lead.utmMedium,
    utmCampaign: lead.utmCampaign,
    utmTerm: lead.utmTerm,
    utmContent: lead.utmContent,
    formId: lead.formId,
    campaignId: lead.campaignId,
    submittedAt: lead.submittedAt.toISOString(),
    ipHash: lead.ipHash,
    userAgentTruncated: lead.userAgentTruncated,
    email: lead.email,
    phone: lead.phone,
    fullName: lead.fullName,
    message: lead.message,
    createdAt: lead.createdAt.toISOString(),
  };
}

function mapLeadDetail(
  lead: import("../persistence/repositories/lead.repository.js").LeadWithExtensions,
) {
  return {
    ...mapLead(lead),
    construction: lead.construction,
    realEstate: lead.realEstate,
  };
}

function mapBlogPostListItem(post: BlogPostRow) {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    status: post.status,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    coverMediaAssetId: post.coverMediaAssetId,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

function mapBlogPostDetail(post: BlogPostWithCover) {
  return {
    ...mapBlogPostListItem(post),
    body: post.body,
    coverUrl: post.coverSecureUrl,
  };
}

function mapPublicBlogPost(post: BlogPostWithCover) {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    body: post.body,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    coverUrl: post.coverSecureUrl,
    updatedAt: post.updatedAt.toISOString(),
  };
}

function mapHiring(row: HiringPositionRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    applicationUrl: row.applicationUrl,
    isPublished: row.isPublished,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapPortfolioRow(row: PortfolioProjectRow) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    imageMediaAssetId: row.imageMediaAssetId,
    isPublished: row.isPublished,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapPortfolioAdmin(row: PortfolioProjectWithImage) {
  return {
    ...mapPortfolioRow(row),
    imageUrl: row.imageSecureUrl,
  };
}

function mapPortfolioPublic(row: PortfolioProjectWithImage) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    imageUrl: row.imageSecureUrl,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt.toISOString(),
  };
}
