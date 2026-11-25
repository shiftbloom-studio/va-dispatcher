import "server-only";

/** Public origin for redirect URIs; falls back to the request's own origin. */
export function appOrigin(request: Request): string {
  const configured = process.env.APP_ORIGIN?.trim();
  return (configured || new URL(request.url).origin).replace(/\/+$/, "");
}

export function callbackUri(request: Request): string {
  return `${appOrigin(request)}/auth/callback`;
}
