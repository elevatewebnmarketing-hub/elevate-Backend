import Fastify from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../src/http/error-handler.js";

describe("registerErrorHandler", () => {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);

  app.get("/pg-dup", async () => {
    const err = new Error("duplicate key") as Error & { code: string };
    err.code = "23505";
    throw err;
  });

  afterAll(async () => {
    await app.close();
  });

  it("maps PostgreSQL 23505 to database_error JSON", async () => {
    const res = await app.inject({ method: "GET", url: "/pg-dup" });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as {
      error: string;
      code: string;
      message: string;
    };
    expect(body.error).toBe("database_error");
    expect(body.code).toBe("23505");
    expect(body.message).toContain("Unique");
  });
});
