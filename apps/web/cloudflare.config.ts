import { bindings, defineConfig, defineWorker } from "cf/config";

/**
 * Web Worker for the vinext build of this Next.js app.
 *
 * Installation-specific values (hostname, operator details) come from the
 * build environment so they never live in the repository. Set them as Workers
 * Builds variables or in a local, untracked .env.deploy; see
 * docs/maintainer-setup.md.
 */
const LEGAL_VARIABLES = [
  "LEGAL_OPERATOR_NAME",
  "LEGAL_OPERATOR_DESCRIPTION",
  "LEGAL_OPERATOR_ADDRESS",
  "LEGAL_OPERATOR_EMAIL",
  "LEGAL_OPERATOR_PHONE",
  "LEGAL_PRIVACY_EMAIL",
  "LEGAL_REPRESENTATIVE",
  "LEGAL_REGISTER_NAME",
  "LEGAL_REGISTER_NUMBER",
  "LEGAL_VAT_ID",
  "LEGAL_EDITORIALLY_RESPONSIBLE_NAME",
  "LEGAL_EDITORIALLY_RESPONSIBLE_ADDRESS",
  "LEGAL_SUPERVISORY_AUTHORITY_NAME",
  "LEGAL_SUPERVISORY_AUTHORITY_URL",
] as const;

/** Local and test overrides; never set them in a production build. */
const LOCAL_OVERRIDE_VARIABLES = [
  "API_ORIGIN",
  "API_INTERNAL_URL",
  "E2E_FIXTURE_SECRET",
] as const;

function textVariables(names: readonly string[]) {
  return Object.fromEntries(
    names
      .filter((name) => process.env[name]?.trim())
      .map((name) => [name, bindings.text(process.env[name]!.trim())]),
  );
}

export default defineConfig({
  worker: defineWorker(({ mode }) => {
    const production = mode !== "development";
    const hostname = process.env.VA_HOSTNAME?.trim();

    return {
      name: "va-dispatch-web",
      entrypoint: "vinext/server/fetch-handler",
      compatibilityDate: "2026-11-25",
      // nodejs_compat also populates process.env from vars and secrets.
      compatibilityFlags: ["nodejs_compat"],
      // workers.dev and preview URLs would bypass the zone's WAF and rate
      // limiting, so the Worker is only reachable on its custom domain.
      workersDev: false,
      previewUrls: false,
      observability: { enabled: true },
      assets: {
        htmlHandling: "none",
        notFoundHandling: "none",
        runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
      },
      // The web Worker is the origin for the whole hostname. The API Worker
      // claims <hostname>/api/* with a zone route, which takes precedence.
      domains: production && hostname ? [hostname] : undefined,
      env: {
        ASSETS: bindings.assets(),
        IMAGES: bindings.images(),
        VINEXT_KV_CACHE: bindings.kv(),
        // Server components reach the API through this service binding; a
        // same-zone fetch cannot target a zone route. Local development uses
        // API_ORIGIN (wrangler dev on port 3001) instead.
        ...(production
          ? { API: bindings.worker({ worker: "va-dispatch-api" }) }
          : {}),
        CLERK_SECRET_KEY: bindings.secret(),
        ...textVariables(LEGAL_VARIABLES),
        ...textVariables(LOCAL_OVERRIDE_VARIABLES),
      },
    };
  }),
});
