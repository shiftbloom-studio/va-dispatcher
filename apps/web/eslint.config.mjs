import { defineConfig, globalIgnores } from "eslint/config";
import { nextTypeScript, nextVitals } from "@va-dispatch/eslint-config";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
