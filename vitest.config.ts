import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  // Same "@/" alias as tsconfig, for tests that import app/ or components/ files.
  resolve: { alias: { "@": new URL(".", import.meta.url).pathname } },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "scripts/**/*.test.ts"],
    // Live API tests cost money: only with LIVE=1 (npm run test:live).
    exclude: process.env.LIVE ? configDefaults.exclude : [...configDefaults.exclude, "**/*.live.test.ts"],
  },
});
