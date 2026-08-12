import type { z } from "zod";

import { errorEnvelopeSchema } from "@/lib/api/schemas";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    requestId?: string | null;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
    this.requestId = input.requestId ?? null;
  }
}

type RequestJsonOptions<TSchema extends z.ZodType> = RequestInit & {
  schema: TSchema;
  token?: string | null;
};

export async function requestJson<TSchema extends z.ZodType>(
  url: string,
  { schema, token, headers, ...init }: RequestJsonOptions<TSchema>,
): Promise<z.output<TSchema>> {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("Accept", "application/json");
  if (token) requestHeaders.set("Authorization", `Bearer ${token}`);

  const response = await fetch(url, {
    ...init,
    cache: init.cache ?? "no-store",
    headers: requestHeaders,
  });
  const requestId = response.headers.get("x-request-id");

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError({
      status: response.status,
      code: "INVALID_RESPONSE",
      message: "The server returned an unreadable response.",
      requestId,
    });
  }

  if (!response.ok) {
    const parsed = errorEnvelopeSchema.safeParse(payload);
    throw new ApiError({
      status: response.status,
      code: parsed.success ? parsed.data.error.code : "REQUEST_FAILED",
      message: parsed.success
        ? parsed.data.error.message
        : "The request failed.",
      details: parsed.success ? parsed.data.error.details : undefined,
      requestId,
    });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError({
      status: response.status,
      code: "INVALID_RESPONSE",
      message: "The server response did not match the expected contract.",
      details: parsed.error.flatten(),
      requestId,
    });
  }

  return parsed.data;
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.requestId
      ? `${error.message} Request ID: ${error.requestId}`
      : error.message;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
