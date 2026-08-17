import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Monaco's prebuilt bundle, vendored by scripts/copy-monaco.mjs. Third
    // party, minified, and thousands of files — linting it buries our own
    // findings under ~25k warnings.
    "public/monaco/**",
  ]),
]);

export default eslintConfig;
