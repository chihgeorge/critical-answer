import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// React may run (or rerun) a state updater after the event, when the input already holds its old value again,
// so a value read from the event inside the updater is lost. Read it into a const before the updater (#147).
const UPDATER = "/^(set[A-Z]|update[A-Z]|onUpdate$)/";
const EVENT_TARGET = "MemberExpression[object.name=/^(e|ev|evt|event)$/][property.name=/^(target|currentTarget)$/]";
const deferredEventRead = {
  message: "Read the event's value into a const before the updater: React may run the updater after the input was reset (#147).",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        { ...deferredEventRead, selector: `CallExpression[callee.name=${UPDATER}] > :function ${EVENT_TARGET}` },
        { ...deferredEventRead, selector: `CallExpression[callee.property.name=${UPDATER}] > :function ${EVENT_TARGET}` },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "coverage/**", ".wrangler/**", ".playtest/**"]),
]);

export default eslintConfig;
