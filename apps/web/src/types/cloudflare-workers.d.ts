// Minimal typing for the Workers runtime module. Full binding types are
// generated into .cloudflare/types by `vite dev` / `vite build`.
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}
