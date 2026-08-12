export const E2E_IDENTITY_COOKIE = "va-e2e-identity";
export const E2E_IDENTITY_HEADER = "X-E2E-Identity";

export type E2eIdentity =
  "signed-out" | "pilot" | "dispatcher" | "admin" | "outsider";

export function e2eIntegratedFixtureEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

export function e2eRouteFixtureEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_E2E_ROUTE_FIXTURE_MODE === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

export function e2eFixtureEnabled(): boolean {
  return e2eIntegratedFixtureEnabled() || e2eRouteFixtureEnabled();
}

export function normalizeE2eIdentity(value: string | undefined): E2eIdentity {
  return value === "pilot" ||
    value === "dispatcher" ||
    value === "admin" ||
    value === "outsider"
    ? value
    : "signed-out";
}
