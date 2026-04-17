import type { SiteRow } from "../persistence/repositories/site.repository.js";

declare module "fastify" {
  interface FastifyRequest {
    site?: SiteRow;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      org_id: string;
      role: string;
    };
    user: {
      sub: string;
      org_id: string;
      role: string;
    };
  }
}
