import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";
import { buildServer } from "../src/http/build-server.js";

describe("HTTP API", () => {
  let app: Awaited<ReturnType<typeof buildServer>>["app"];

  beforeAll(async () => {
    const env = loadEnv();
    ({ app } = await buildServer(env));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it("GET /v1/health returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("GET /v1/leads without JWT returns 401", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/leads" });
    expect(res.statusCode).toBe(401);
  });
});
