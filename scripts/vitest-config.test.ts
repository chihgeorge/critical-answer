// vitest.config.ts: the component tests (components/*.test.ts, *.test.tsx) run with the rest.
import { describe, expect, it } from "vitest";
import config from "../vitest.config";

describe("vitest.config.ts", () => {
  it("includes the component tests", () => {
    expect(config.test?.include).toEqual(expect.arrayContaining(["components/**/*.test.ts", "components/**/*.test.tsx"]));
  });
});
