import { defineConfig } from "@playwright/test";

// Own ports, so the suite never collides with a dev server (or another project) on 3000/1999.
const WEB = 3101;
const PARTY = 1996;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: `http://localhost:${WEB}` },
  webServer: [
    { command: `npx partykit dev --port ${PARTY}`, port: PARTY, reuseExistingServer: false, timeout: 60_000 },
    {
      command: `npx next dev -p ${WEB}`,
      port: WEB,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { NEXT_PUBLIC_PARTYKIT_HOST: `localhost:${PARTY}` },
    },
  ],
});
