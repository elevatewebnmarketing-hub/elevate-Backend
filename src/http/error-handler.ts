import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

/** Postgres driver / node-postgres style */
function pgCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const c = (err as { code?: string }).code;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}

function mapPg(code: string): { message: string; hint?: string } {
  const map: Record<string, { message: string; hint?: string }> = {
    "23505": {
      message: "Unique constraint violation",
      hint: "A row with this value already exists (duplicate slug, email, or key).",
    },
    "23503": {
      message: "Foreign key violation",
      hint: "Referenced organization, site, or user does not exist, or delete is blocked by existing data.",
    },
    "23502": {
      message: "Not null violation",
      hint: "A required field was missing.",
    },
    "22P02": {
      message: "Invalid data format",
      hint: "Often an invalid UUID or enum value.",
    },
    "42P01": {
      message: "Undefined table",
      hint: "Migrations may not have been applied.",
    },
  };
  return (
    map[code] ?? {
      message: "Database error",
      hint: `PostgreSQL code ${code}`,
    }
  );
}

export function registerErrorHandler(
  app: {
    setErrorHandler: (
      fn: (
        error: FastifyError,
        request: FastifyRequest,
        reply: FastifyReply,
      ) => void,
    ) => void;
    log: { error: (obj: unknown) => void };
  },
): void {
  app.setErrorHandler((error, request, reply) => {
    app.log.error({ err: error, reqId: request.id, url: request.url });

    const code = pgCode(error);
    if (code) {
      const { message, hint } = mapPg(code);
      return reply.status(400).send({
        error: "database_error",
        code,
        message,
        hint,
      });
    }

    if (error.validation) {
      return reply.status(400).send({
        error: "validation_error",
        message: error.message,
        details: error.validation,
      });
    }

    const statusCode = error.statusCode ?? 500;
    const safeMessage =
      statusCode >= 500
        ? "Internal server error"
        : error.message || "Request failed";

    return reply.status(statusCode).send({
      error: error.code ?? "error",
      message: safeMessage,
    });
  });
}
