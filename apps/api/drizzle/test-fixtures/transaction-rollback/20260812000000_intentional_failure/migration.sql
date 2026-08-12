CREATE TABLE "migration_partial_execution_probe" (
  "id" integer PRIMARY KEY
);--> statement-breakpoint
SELECT 1 / 0;
