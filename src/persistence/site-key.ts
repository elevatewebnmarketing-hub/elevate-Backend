import { createHash } from "node:crypto";

export function hashSiteKey(rawKey: string, pepper: string): string {
  return createHash("sha256")
    .update(rawKey + pepper, "utf8")
    .digest("hex");
}

export function hashIp(ip: string | undefined, pepper: string): string | undefined {
  if (!ip) return undefined;
  return createHash("sha256")
    .update(ip + pepper, "utf8")
    .digest("hex")
    .slice(0, 32);
}
