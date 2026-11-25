import "server-only";

type ServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

let binding: Promise<ServiceBinding | null> | null = null;

function loadBinding(): Promise<ServiceBinding | null> {
  // `cloudflare:workers` only exists in workerd (the vinext build). Elsewhere
  // the import fails and identity calls use the public network.
  binding ??= import("cloudflare:workers").then(
    ({ env }) => (env as { IDENTITY?: ServiceBinding }).IDENTITY ?? null,
    () => null,
  );
  return binding;
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  return new URL(typeof input === "string" ? input : input.url);
}

/**
 * fetch() for calls to the identity provider (discovery, JWKS, tokens,
 * revocation). URLs on the issuer's origin go through the IDENTITY service
 * binding when it is bound, so Worker-to-Worker calls skip the zone's bot
 * protection. Everything else uses the public network.
 */
export function identityFetch(issuer: string): typeof fetch {
  return async (input, init) => {
    const identity = await loadBinding();
    if (identity && requestUrl(input).origin === new URL(issuer).origin) {
      return identity.fetch(new Request(input, init));
    }
    return fetch(input, init);
  };
}
