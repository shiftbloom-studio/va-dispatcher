import { z } from "zod";

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export type CursorPayload = {
  sortAt: string;
  id: string;
};

const cursorPayloadSchema = z
  .object({
    sortAt: z.string().datetime({ offset: true }),
    id: z.string(),
  })
  .strict();

const flightCursorPayloadSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("flight-etd-desc"),
    etd: z.string().datetime({ offset: true }),
    id: z.string().uuid(),
  })
  .strict();

export type FlightCursorPayload = z.infer<typeof flightCursorPayloadSchema>;

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    return cursorPayloadSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("Invalid cursor");
  }
}

/**
 * Flight cursors deliberately have their own versioned contract because the
 * flight list is ordered by scheduled departure rather than creation time.
 * Other list cursors are rejected instead of being interpreted ambiguously.
 */
export function encodeFlightCursor(
  payload: Pick<FlightCursorPayload, "etd" | "id">,
): string {
  const versionedPayload = flightCursorPayloadSchema.parse({
    v: 1,
    kind: "flight-etd-desc",
    ...payload,
  });
  return Buffer.from(JSON.stringify(versionedPayload), "utf8").toString(
    "base64url",
  );
}

export function decodeFlightCursor(cursor: string): FlightCursorPayload {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    return flightCursorPayloadSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("Invalid or incompatible flight cursor");
  }
}

export const flightCursorQuerySchema = z
  .string()
  .min(1)
  .max(1024)
  .transform((cursor, context) => {
    try {
      return decodeFlightCursor(cursor);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Invalid or incompatible flight cursor",
      });
      return z.NEVER;
    }
  });

export type PageResult<T> = {
  items: T[];
  nextCursor: string | null;
};
