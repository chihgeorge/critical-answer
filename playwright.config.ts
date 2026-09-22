import { defineConfig } from "@playwright/test";

// Own ports, so the suite never collides with a dev server (or another project) on 3000/8787.
const WEB = 3101;
const WORKER = 1996;
// Fixed, e2e-only owner key — this run's Durable Object storage is wiped first (--persist-to
// .wrangler/e2e, rm -rf'd below), so a fixed value here is not a real secret.
export const E2E_OWNER_KEY = "e2e-owner-key-not-a-real-secret-0123456789";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: `http://localhost:${WEB}` },
  webServer: [
    {
      // The same runtime as production (workerd). Each run starts from empty Durable Object storage, and
      // ANTHROPIC_API_KEY is forced empty so a .env with a real key can never make the tests call the API.
      command:
        `sh -c "rm -rf .wrangler/e2e && npx wrangler dev --port ${WORKER} --persist-to .wrangler/e2e ` +
        `--var ALLOWED_ORIGINS:* --var ANTHROPIC_API_KEY: --var OWNER_KEY:${E2E_OWNER_KEY}"`,
      url: `http://localhost:${WORKER}/healthz`,
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command: `npx next dev -p ${WEB}`,
      port: WEB,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { NEXT_PUBLIC_PARTYKIT_HOST: `localhost:${WORKER}` },
    },
  ],
});
