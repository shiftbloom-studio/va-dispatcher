import type { ErrorHandler } from "hono";
import { ZodError } from "zod";
import { isAppError } from "../lib/errors.js";

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "Validation failed",
          details: err.issues,
        },
      },
      400,
    );
  }

  if (isAppError(err)) {
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      },
      err.status as 400,
    );
  }

  if (err instanceof Error && err.message === "Invalid cursor") {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "Invalid cursor",
        },
      },
      400,
    );
  }

  console.error("Unhandled error", err);
  return c.json(
    {
      error: {
        code: "INTERNAL",
        message: "Internal server error",
      },
    },
    500,
  );
};
