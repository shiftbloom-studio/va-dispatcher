import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  ssr: {
    // Ensure problematic ESM dependencies are transpiled for Node test runtime
    noExternal: ["@swc/helpers", "next"],
  },
  resolve: {
    alias: [
      {
        find: "@/components/optional-telemetry",
        replacement: fileURLToPath(
          new URL("./src/test/stubs/optional-telemetry.tsx", import.meta.url),
        ),
      },
      {
        find: "next/link",
        replacement: fileURLToPath(
          new URL("./src/test/stubs/next-link.tsx", import.meta.url),
        ),
      },
      {
        find: "next/navigation",
        replacement: fileURLToPath(
          new URL("./src/test/stubs/next-navigation.ts", import.meta.url),
        ),
      },
      {
        find: "next/dynamic",
        replacement: fileURLToPath(
          new URL("./src/test/stubs/next-dynamic.tsx", import.meta.url),
        ),
      },
      {
        find: "next/headers",
        replacement: fileURLToPath(
          new URL("./src/test/stubs/next-headers.ts", import.meta.url),
        ),
      },
      {
        find: "next/dist/shared/lib/router-context.shared-runtime.js",
        replacement: fileURLToPath(
          new URL(
            "./src/test/stubs/next-router-context-shared-runtime.js",
            import.meta.url,
          ),
        ),
      },
      {
        find: "next/dist/client/components/navigation.js",
        replacement: fileURLToPath(
          new URL(
            "./src/test/stubs/next-client-components-navigation.js",
            import.meta.url,
          ),
        ),
      },
      {
        find: "server-only",
        replacement: fileURLToPath(
          new URL("./src/test/server-only.ts", import.meta.url),
        ),
      },
      {
        find: "@",
        replacement: fileURLToPath(new URL("./src", import.meta.url)),
      },
    ],
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
