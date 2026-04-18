import bcrypt from "bcrypt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Env } from "../config/env.js";
import type { Db } from "../persistence/db.js";
import { createSuperAdminRepository } from "../persistence/repositories/super-admin.repository.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const orgCreateSchema = z.object({
  name: z.string().min(1).max(500),
  slug: z.string().min(1).max(200),
});

const orgPatchSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  slug: z.string().min(1).max(200).optional(),
});

const siteCreateSchema = z.object({
  organizationId: z.string().uuid(),
  label: z.string().min(1).max(500),
  allowedOrigins: z.array(z.string()).optional().nullable(),
});

const sitePatchSchema = z.object({
  label: z.string().min(1).max(500).optional(),
  allowedOrigins: z.array(z.string()).optional().nullable(),
  isActive: z.boolean().optional(),
});

const userCreateSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["org_admin", "org_viewer"]),
});

const userPatchSchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(["org_admin", "org_viewer"]).optional(),
});

const passwordSchema = z.object({
  password: z.string().min(8),
});

const superAdminMeEmailSchema = z.object({
  email: z.string().email(),
  currentPassword: z.string().min(1),
});

const superAdminMePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

function superAdminIdFromRequest(req: FastifyRequest): string | undefined {
  const u = req.user as { sub?: unknown } | undefined;
  const sub = u?.sub;
  return typeof sub === "string" ? sub : undefined;
}

const mediaListQuerySchema = z.object({
  q: z.string().optional(),
  organizationId: z.string().uuid().optional(),
  resourceType: z.enum(["image", "video"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function stripUser(u: {
  id: string;
  organizationId: string;
  email: string;
  passwordHash: string;
  role: string;
  createdAt: Date;
}) {
  const { passwordHash: _, ...rest } = u;
  return rest;
}

export async function registerSuperAdminRoutes(
  app: FastifyInstance,
  opts: { env: Env; db: Db },
): Promise<void> {
  const { env, db } = opts;
  const repo = createSuperAdminRepository(db, env);

  const ipAllowAndVerifySuperJwt = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    if (env.SUPER_ADMIN_ALLOWED_IPS.length > 0) {
      const xf = req.headers["x-forwarded-for"];
      const ip =
        typeof xf === "string"
          ? xf.split(",")[0]?.trim()
          : req.socket.remoteAddress ?? req.ip;
      if (!ip || !env.SUPER_ADMIN_ALLOWED_IPS.includes(ip)) {
        return reply.status(403).send({
          error: "forbidden",
          message: "Client IP is not allowed for super-admin routes",
          hint: "Update SUPER_ADMIN_ALLOWED_IPS or your network.",
        });
      }
    }
    try {
      await req.superAdminJwtVerify();
    } catch {
      return reply.status(401).send({ error: "unauthorized" });
    }
  };

  const ipAllowOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    if (env.SUPER_ADMIN_ALLOWED_IPS.length > 0) {
      const xf = req.headers["x-forwarded-for"];
      const ip =
        typeof xf === "string"
          ? xf.split(",")[0]?.trim()
          : req.socket.remoteAddress ?? req.ip;
      if (!ip || !env.SUPER_ADMIN_ALLOWED_IPS.includes(ip)) {
        return reply.status(403).send({
          error: "forbidden",
          message: "Client IP is not allowed for super-admin routes",
        });
      }
    }
  };

  app.post(
    "/v1/super-admin/auth/login",
    {
      preHandler: ipAllowOnly,
      config: {
        rateLimit: {
          max: env.AUTH_LOGIN_RATE_MAX,
          timeWindow: env.AUTH_LOGIN_RATE_WINDOW_MS,
        },
      },
      schema: {
        tags: ["super-admin"],
        summary: "Super admin login (separate JWT)",
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const row = await repo.findByEmail(parsed.data.email);
      if (!row) {
        return reply.status(401).send({ error: "invalid_credentials" });
      }
      const ok = await bcrypt.compare(parsed.data.password, row.passwordHash);
      if (!ok) {
        return reply.status(401).send({ error: "invalid_credentials" });
      }
      const token = await reply.superAdminJwtSign({
        sub: row.id,
        email: row.email,
      });
      return reply.send({
        access_token: token,
        token_type: "Bearer",
        expires_in: env.SUPER_ADMIN_ACCESS_EXPIRES_IN,
      });
    },
  );

  app.get(
    "/v1/super-admin/me",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        summary: "Current super-admin profile (no secrets)",
      },
    },
    async (req, reply) => {
      const id = superAdminIdFromRequest(req);
      if (!id) {
        return reply.status(401).send({ error: "unauthorized" });
      }
      const row = await repo.findSuperAdminById(id);
      if (!row) {
        return reply.status(404).send({ error: "not_found" });
      }
      return {
        id: row.id,
        email: row.email,
        createdAt: row.createdAt.toISOString(),
      };
    },
  );

  app.patch(
    "/v1/super-admin/me/email",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        summary: "Change super-admin email (requires current password)",
        body: {
          type: "object",
          required: ["email", "currentPassword"],
          properties: {
            email: { type: "string", format: "email" },
            currentPassword: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const id = superAdminIdFromRequest(req);
      if (!id) {
        return reply.status(401).send({ error: "unauthorized" });
      }
      const parsed = superAdminMeEmailSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const row = await repo.findSuperAdminById(id);
      if (!row) {
        return reply.status(404).send({ error: "not_found" });
      }
      const ok = await bcrypt.compare(
        parsed.data.currentPassword,
        row.passwordHash,
      );
      if (!ok) {
        return reply.status(401).send({ error: "invalid_credentials" });
      }
      const nextEmail = parsed.data.email.toLowerCase();
      const existing = await repo.findByEmail(nextEmail);
      if (existing && existing.id !== id) {
        return reply.status(409).send({
          error: "email_taken",
          message: "That email is already in use.",
        });
      }
      const updated = await repo.updateSuperAdminEmail(id, nextEmail);
      if (!updated) {
        return reply.status(404).send({ error: "not_found" });
      }
      const token = await reply.superAdminJwtSign({
        sub: updated.id,
        email: updated.email,
      });
      return reply.send({
        id: updated.id,
        email: updated.email,
        createdAt: updated.createdAt.toISOString(),
        access_token: token,
        token_type: "Bearer" as const,
        expires_in: env.SUPER_ADMIN_ACCESS_EXPIRES_IN,
      });
    },
  );

  app.post(
    "/v1/super-admin/me/password",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        summary: "Change super-admin password",
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: { type: "string" },
            newPassword: { type: "string", minLength: 8 },
          },
        },
      },
    },
    async (req, reply) => {
      const id = superAdminIdFromRequest(req);
      if (!id) {
        return reply.status(401).send({ error: "unauthorized" });
      }
      const parsed = superAdminMePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const row = await repo.findSuperAdminById(id);
      if (!row) {
        return reply.status(404).send({ error: "not_found" });
      }
      const ok = await bcrypt.compare(
        parsed.data.currentPassword,
        row.passwordHash,
      );
      if (!ok) {
        return reply.status(401).send({ error: "invalid_credentials" });
      }
      await repo.setSuperAdminPassword(id, parsed.data.newPassword);
      return reply.status(204).send();
    },
  );

  app.get(
    "/v1/super-admin/organizations",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        summary: "List all organizations",
      },
    },
    async () => {
      const rows = await repo.listOrganizations();
      return { items: rows };
    },
  );

  app.post(
    "/v1/super-admin/organizations",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        summary: "Create organization",
        body: {
          type: "object",
          required: ["name", "slug"],
          properties: {
            name: { type: "string" },
            slug: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const parsed = orgCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const row = await repo.createOrganization(parsed.data);
      return reply.status(201).send(row);
    },
  );

  app.get(
    "/v1/super-admin/organizations/:id",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = await repo.getOrganization(id);
      if (!row) return reply.status(404).send({ error: "not_found" });
      return row;
    },
  );

  app.patch(
    "/v1/super-admin/organizations/:id",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = orgPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const row = await repo.updateOrganization(id, parsed.data);
      if (!row) return reply.status(404).send({ error: "not_found" });
      return row;
    },
  );

  app.delete(
    "/v1/super-admin/organizations/:id",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = await repo.getOrganization(id);
      if (!existing) return reply.status(404).send({ error: "not_found" });
      await repo.deleteOrganization(id);
      return reply.status(204).send();
    },
  );

  app.get(
    "/v1/super-admin/sites",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        querystring: {
          type: "object",
          properties: { organizationId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req) => {
      const q = req.query as { organizationId?: string };
      const rows = await repo.listSites(q.organizationId);
      return {
        items: rows.map((r) => ({
          ...r.site,
          organizationName: r.organizationName,
          organizationSlug: r.organizationSlug,
          keyPreview: `${r.site.keyHash.slice(0, 8)}…`,
        })),
      };
    },
  );

  app.post(
    "/v1/super-admin/sites",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        summary: "Create site; returns plaintext site key once in `plaintextKey`",
      },
    },
    async (req, reply) => {
      const parsed = siteCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const org = await repo.getOrganization(parsed.data.organizationId);
      if (!org) {
        return reply.status(400).send({ error: "organization_not_found" });
      }
      const { site, plaintextKey } = await repo.createSite(parsed.data);
      return reply.status(201).send({
        site: {
          ...site,
          keyPreview: `${site.keyHash.slice(0, 8)}…`,
        },
        plaintextKey,
      });
    },
  );

  app.patch(
    "/v1/super-admin/sites/:id",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = sitePatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const row = await repo.updateSite(id, parsed.data);
      if (!row) return reply.status(404).send({ error: "not_found" });
      return row;
    },
  );

  app.post(
    "/v1/super-admin/sites/:id/rotate-key",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        summary: "Rotate publishable site key; returns new plaintext key once",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = await repo.getSite(id);
      if (!existing) return reply.status(404).send({ error: "not_found" });
      const { site, plaintextKey } = await repo.rotateSiteKey(id);
      return {
        site: { ...site, keyPreview: `${site.keyHash.slice(0, 8)}…` },
        plaintextKey,
      };
    },
  );

  app.delete(
    "/v1/super-admin/sites/:id",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = await repo.getSite(id);
      if (!existing) return reply.status(404).send({ error: "not_found" });
      try {
        await repo.deleteSite(id);
      } catch {
        return reply.status(400).send({
          error: "delete_blocked",
          message:
            "Site may have leads referencing it; delete leads or use restrict policy.",
        });
      }
      return reply.status(204).send();
    },
  );

  app.get(
    "/v1/super-admin/users",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        querystring: {
          type: "object",
          properties: { organizationId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req) => {
      const q = req.query as { organizationId?: string };
      const rows = await repo.listUsers(q.organizationId);
      return {
        items: rows.map((r) => ({
          ...stripUser(r.user),
          organizationName: r.organizationName,
          organizationSlug: r.organizationSlug,
        })),
      };
    },
  );

  app.post(
    "/v1/super-admin/users",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: { tags: ["super-admin"], security: [{ superAdminBearer: [] }] },
    },
    async (req, reply) => {
      const parsed = userCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const org = await repo.getOrganization(parsed.data.organizationId);
      if (!org) {
        return reply.status(400).send({ error: "organization_not_found" });
      }
      const row = await repo.createUser(parsed.data);
      if (!row) {
        return reply.status(500).send({ error: "user_create_failed" });
      }
      return reply.status(201).send(stripUser(row));
    },
  );

  app.get(
    "/v1/super-admin/users/:id",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = await repo.getUser(id);
      if (!row) return reply.status(404).send({ error: "not_found" });
      return stripUser(row);
    },
  );

  app.patch(
    "/v1/super-admin/users/:id",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = userPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const data = parsed.data;
      const update: { email?: string; role?: string } = {};
      if (data.email) update.email = data.email.toLowerCase();
      if (data.role) update.role = data.role;
      const row = await repo.updateUser(id, update);
      if (!row) return reply.status(404).send({ error: "not_found" });
      return stripUser(row);
    },
  );

  app.post(
    "/v1/super-admin/users/:id/password",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = passwordSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const row = await repo.setUserPassword(id, parsed.data.password);
      if (!row) return reply.status(404).send({ error: "not_found" });
      return { ok: true };
    },
  );

  app.delete(
    "/v1/super-admin/users/:id",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = await repo.getUser(id);
      if (!existing) return reply.status(404).send({ error: "not_found" });
      await repo.deleteUser(id);
      return reply.status(204).send();
    },
  );

  app.get(
    "/v1/super-admin/media-assets",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        summary: "List media assets uploaded across organizations",
        querystring: {
          type: "object",
          properties: {
            q: { type: "string" },
            organizationId: { type: "string", format: "uuid" },
            resourceType: { type: "string", enum: ["image", "video"] },
            limit: { type: "integer", minimum: 1, maximum: 200 },
            offset: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      const parsed = mediaListQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }
      const q = parsed.data;
      const limit = q.limit ?? 50;
      const offset = q.offset ?? 0;
      const result = await repo.listMediaAssets({
        q: q.q,
        organizationId: q.organizationId,
        resourceType: q.resourceType,
        limit,
        offset,
      });
      return {
        items: result.items.map((row) => ({
          ...row.asset,
          organizationName: row.organizationName,
          organizationSlug: row.organizationSlug,
          uploaderEmail: row.uploaderEmail,
        })),
        total: result.total,
        limit,
        offset,
      };
    },
  );

  app.get(
    "/v1/super-admin/leads",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        querystring: {
          type: "object",
          properties: {
            q: { type: "string" },
            organizationId: { type: "string", format: "uuid" },
            limit: { type: "integer", minimum: 1, maximum: 200 },
            offset: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (req) => {
      const q = req.query as {
        q?: string;
        organizationId?: string;
        limit?: string;
        offset?: string;
      };
      const limit = Math.min(Number(q.limit) || 50, 200);
      const offset = Number(q.offset) || 0;
      const result = await repo.listLeads({
        q: q.q,
        organizationId: q.organizationId,
        limit,
        offset,
      });
      return {
        items: result.items.map((row) => ({
          ...row.lead,
          organizationName: row.organizationName,
          siteLabel: row.siteLabel,
        })),
        total: result.total,
        limit,
        offset,
      };
    },
  );

  app.get(
    "/v1/super-admin/leads/:id",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = await repo.getLeadWithExtensions(id);
      if (!row) return reply.status(404).send({ error: "not_found" });
      return row;
    },
  );

  app.delete(
    "/v1/super-admin/leads/:id",
    {
      preHandler: ipAllowAndVerifySuperJwt,
      schema: {
        tags: ["super-admin"],
        security: [{ superAdminBearer: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = await repo.getLeadWithExtensions(id);
      if (!existing) return reply.status(404).send({ error: "not_found" });
      await repo.deleteLead(id);
      return reply.status(204).send();
    },
  );
}
