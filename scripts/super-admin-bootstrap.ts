import "dotenv/config";
import bcrypt from "bcrypt";
import { count } from "drizzle-orm";
import { loadEnv } from "../src/config/env.js";
import { createDb } from "../src/persistence/db.js";
import { superAdmins } from "../src/persistence/schema.js";

async function main() {
  const env = loadEnv();
  const { db, client } = createDb(env);

  const [{ n }] = await db.select({ n: count() }).from(superAdmins);
  if (n > 0) {
    console.log("super_admins already has rows; skip bootstrap.");
    await client.end({ timeout: 5 });
    return;
  }

  if (!env.SUPER_ADMIN_BOOTSTRAP_EMAIL || !env.SUPER_ADMIN_BOOTSTRAP_PASSWORD) {
    console.log(
      "No super_admins rows. Set SUPER_ADMIN_BOOTSTRAP_EMAIL and SUPER_ADMIN_BOOTSTRAP_PASSWORD to create the first admin, then run this script once and remove the password from env.",
    );
    await client.end({ timeout: 5 });
    return;
  }

  const passwordHash = await bcrypt.hash(
    env.SUPER_ADMIN_BOOTSTRAP_PASSWORD,
    12,
  );
  await db.insert(superAdmins).values({
    email: env.SUPER_ADMIN_BOOTSTRAP_EMAIL.toLowerCase(),
    passwordHash,
  });
  console.log(
    "Super admin bootstrap complete for:",
    env.SUPER_ADMIN_BOOTSTRAP_EMAIL,
  );

  await client.end({ timeout: 5 });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
