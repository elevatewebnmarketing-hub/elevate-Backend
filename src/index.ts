import "dotenv/config";
import { loadEnv } from "./config/env.js";
import { buildServer } from "./http/build-server.js";

async function main() {
  const env = loadEnv();
  const { app } = await buildServer(env);
  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
