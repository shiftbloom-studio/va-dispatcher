import "server-only";

/** Public origin for redirect URIs; falls back to the request's own origin. */
export function appOrigin(request: Request): string {
  const configured = process.env.APP_ORIGIN?.trim();
  return trimTrailingSlashes(configured || new URL(request.url).origin);
}

/** Removes trailing "/" characters in linear time (no regex backtracking). */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}

export function callbackUri(request: Request): string {
  return `${appOrigin(request)}/auth/callback`;
}
