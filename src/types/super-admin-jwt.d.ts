import "@fastify/jwt";

declare module "fastify" {
  interface FastifyRequest {
    superAdminJwtVerify(): Promise<{ sub: string; email?: string }>;
  }

  interface FastifyReply {
    superAdminJwtSign(
      payload: Record<string, string | number | boolean>,
      options?: object,
    ): Promise<string>;
  }
}
