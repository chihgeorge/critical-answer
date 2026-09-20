import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["lib/**/*.test.ts", "party/**/*.test.ts"],
    // Live API tests cost money: only with LIVE=1 (npm run test:live).
    exclude: process.env.LIVE ? configDefaults.exclude : [...configDefaults.exclude, "**/*.live.test.ts"],
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
