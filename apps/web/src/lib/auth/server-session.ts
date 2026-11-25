import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { AuthNotConfiguredError, authConfig } from "@/lib/auth/config";
import {
  accessTokenFresh,
  readSession,
  SESSION_COOKIE,
  type Session,
} from "@/lib/auth/session";

/**
 * The signed-in session for server components. The proxy has already
 * refreshed it; a token that is still expired here means signed out.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  let config;
  try {
    config = authConfig();
  } catch (error) {
    // Local development without a registered stem client: nobody is
    // signed in. Production fails loudly instead.
    if (
      error instanceof AuthNotConfiguredError &&
      process.env.NODE_ENV !== "production"
    ) {
      return null;
    }
    throw error;
  }
  const session = await readSession(
    (await cookies()).get(SESSION_COOKIE)?.value,
    config,
  );
  return session && accessTokenFresh(session, 0) ? session : null;
});
