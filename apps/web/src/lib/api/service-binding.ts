import "server-only";

type ServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

let binding: Promise<ServiceBinding | null> | null = null;

function loadBinding(): Promise<ServiceBinding | null> {
  // `cloudflare:workers` only exists in workerd (the vinext build). Under
  // `next dev` the import fails and requests use API_ORIGIN instead.
  binding ??= import("cloudflare:workers").then(
    ({ env }) => (env as { API?: ServiceBinding }).API ?? null,
    () => null,
  );
  return binding;
}

/**
 * Fetch through the API Worker service binding when it is bound (production
 * on Workers). Returns null elsewhere.
 */
export async function apiServiceFetch(): Promise<typeof fetch | null> {
  const api = await loadBinding();
  if (!api) return null;
  return (input, init) => api.fetch(new Request(input, init));
}
