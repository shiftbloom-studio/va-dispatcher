import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../client.js";
import {
  flightOperationalEvents,
  type FlightEventKind,
  type FlightEventSource,
  type FlightOperationalEvent,
} from "../schema.js";

export async function createFlightEvent(input: {
  tenantId: string;
  flightId: string;
  kind: FlightEventKind;
  source: FlightEventSource;
  occurredAt: Date;
  actorMembershipId?: string | null;
  acarsMessageId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<FlightOperationalEvent> {
  const db = getDb();
  const [created] = await db
    .insert(flightOperationalEvents)
    .values({
      ...input,
      actorMembershipId: input.actorMembershipId ?? null,
      acarsMessageId: input.acarsMessageId ?? null,
      meta: input.meta ?? {},
    })
    .returning();
  return created!;
}

export async function listFlightEvents(
  tenantId: string,
  flightId: string,
): Promise<FlightOperationalEvent[]> {
  const db = getDb();
  return db
    .select()
    .from(flightOperationalEvents)
    .where(
      and(
        eq(flightOperationalEvents.tenantId, tenantId),
        eq(flightOperationalEvents.flightId, flightId),
      ),
    )
    .orderBy(desc(flightOperationalEvents.occurredAt));
}
