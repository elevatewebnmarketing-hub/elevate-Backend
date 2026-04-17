import { describe, expect, it } from "vitest";
import { hashSiteKey } from "../src/persistence/site-key.js";

describe("hashSiteKey", () => {
  it("is deterministic for same inputs", () => {
    const a = hashSiteKey("my-key", "pepper");
    const b = hashSiteKey("my-key", "pepper");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("changes when pepper changes", () => {
    const a = hashSiteKey("my-key", "pepper-a");
    const b = hashSiteKey("my-key", "pepper-b");
    expect(a).not.toBe(b);
  });
});
