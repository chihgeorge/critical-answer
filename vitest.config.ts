import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    // Live API tests cost money: only with LIVE=1 (npm run test:live).
    exclude: process.env.LIVE ? configDefaults.exclude : [...configDefaults.exclude, "**/*.live.test.ts"],
  },
});
