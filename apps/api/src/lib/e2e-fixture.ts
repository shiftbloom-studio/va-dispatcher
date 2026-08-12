import { timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

export function isE2eFixtureAuthorized(
  providedToken: string | undefined,
): boolean {
  const config = env();
  if (
    config.NODE_ENV === "production" ||
    !config.E2E_FIXTURE_MODE ||
    !config.E2E_FIXTURE_SECRET ||
    !providedToken
  ) {
    return false;
  }
  const expected = Buffer.from(config.E2E_FIXTURE_SECRET, "utf8");
  const provided = Buffer.from(providedToken, "utf8");
  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}
