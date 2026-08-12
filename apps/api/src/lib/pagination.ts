import { z } from "zod";

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export type CursorPayload = {
  createdAt: string;
  id: string;
};

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as CursorPayload;
    if (!parsed.createdAt || !parsed.id) {
      throw new Error("invalid");
    }
    return parsed;
  } catch {
    throw new Error("Invalid cursor");
  }
}

export type PageResult<T> = {
  items: T[];
  nextCursor: string | null;
};
