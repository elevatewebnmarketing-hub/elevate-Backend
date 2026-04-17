import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { loadEnv } from "../src/config/env.js";
import { createDb } from "../src/persistence/db.js";
import { hashSiteKey } from "../src/persistence/site-key.js";
import {
  organizations,
  sites,
  users,
} from "../src/persistence/schema.js";

async function main() {
  const env = loadEnv();
  const { db, client } = createDb(env);

  const slug = process.env.SEED_ORG_SLUG ?? "demo-org";
  const orgName = process.env.SEED_ORG_NAME ?? "Demo Organization";
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe!123";
  const rawSiteKey = process.env.SEED_SITE_KEY ?? `site_${cryptoRandom()}`;

  const [existing] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);

  if (existing) {
    console.log("Organization already exists for slug:", slug);
    await client.end({ timeout: 5 });
    return;
  }

  const [org] = await db
    .insert(organizations)
    .values({ name: orgName, slug })
    .returning();

  if (!org) throw new Error("Failed to insert organization");

  const keyHash = hashSiteKey(rawSiteKey, env.SITE_KEY_PEPPER);
  await db.insert(sites).values({
    organizationId: org.id,
    keyHash,
    label: "Default site",
    allowedOrigins: null,
    isActive: true,
  });

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await db.insert(users).values({
    organizationId: org.id,
    email: adminEmail.toLowerCase(),
    passwordHash,
    role: "org_admin",
  });

  console.log("Seed complete.");
  console.log("  Organization slug:", slug);
  console.log("  Admin email:", adminEmail);
  console.log("  Admin password:", adminPassword);
  console.log("  Publishable site key (store in frontend PUBLIC_SITE_KEY):", rawSiteKey);

  await client.end({ timeout: 5 });
}

function cryptoRandom(): string {
  return randomBytes(16).toString("hex");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
