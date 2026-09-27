import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  ssr: {
    // Ensure problematic ESM dependencies are transpiled for Node test runtime
    noExternal: ["@swc/helpers", "next"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./src/test/server-only.ts", import.meta.url),
      ),
      "next/link": fileURLToPath(
        new URL("./src/test/stubs/next-link.tsx", import.meta.url),
      ),
      "next/navigation": fileURLToPath(
        new URL("./src/test/stubs/next-navigation.ts", import.meta.url),
      ),
      "next/dynamic": fileURLToPath(
        new URL("./src/test/stubs/next-dynamic.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    environment: "jsdom",
    pool: "vmThreads",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    server: {
      deps: {
        // Inline ESM helpers used by Next.js to avoid CJS/ESM interop issues under Vitest
        inline: ["@swc/helpers"],
      },
    },
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/test/**"],
      reporter: ["text", "html", "lcov", "json-summary"],
      thresholds: {
        statements: 34,
        branches: 24,
        functions: 27,
        lines: 34,
      },
    },
  },
});
