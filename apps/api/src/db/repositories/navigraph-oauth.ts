import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { getDb } from "../client.js";
import {
  navigraphOauthTransactions,
  type NavigraphOauthTransaction,
} from "../schema.js";

export async function createNavigraphOauthTransaction(input: {
  tenantId: string;
  membershipId: string;
  stateHash: string;
  codeVerifierEnc: string;
  expiresAt: Date;
}): Promise<NavigraphOauthTransaction> {
  const db = getDb();
  const [created] = await db
    .insert(navigraphOauthTransactions)
    .values(input)
    .returning();
  return created!;
}

/** Atomically consume a live state so concurrent/replayed callbacks lose. */
export async function consumeNavigraphOauthTransaction(
  stateHash: string,
  consumedAt: Date,
): Promise<NavigraphOauthTransaction | null> {
  const db = getDb();
  const [consumed] = await db
    .update(navigraphOauthTransactions)
    .set({ consumedAt })
    .where(
      and(
        eq(navigraphOauthTransactions.stateHash, stateHash),
        isNull(navigraphOauthTransactions.consumedAt),
        gt(navigraphOauthTransactions.expiresAt, consumedAt),
      ),
    )
    .returning();
  return consumed ?? null;
}

/** Opportunistic cleanup for browser flows that were started but abandoned. */
export async function deleteExpiredNavigraphOauthTransactions(
  before: Date,
): Promise<void> {
  const db = getDb();
  await db
    .delete(navigraphOauthTransactions)
    .where(lt(navigraphOauthTransactions.expiresAt, before));
}
