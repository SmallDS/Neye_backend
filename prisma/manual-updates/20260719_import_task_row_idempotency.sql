BEGIN;

-- Prisma db push cannot add this required column while legacy rows exist.
-- Add it as nullable, backfill the same deterministic key used by the app,
-- validate uniqueness, and only then enforce the final schema constraint.
DO $$
BEGIN
  IF to_regclass(current_schema() || '.import_task_rows') IS NULL THEN
    RAISE NOTICE 'import_task_rows does not exist; skipping legacy backfill';
  ELSE
    ALTER TABLE "import_task_rows"
      ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(100);

    UPDATE "import_task_rows"
    SET "idempotency_key" = "task_id"::text || ':' || "row_no"::text
    WHERE "idempotency_key" IS NULL;

    IF EXISTS (
      SELECT 1
      FROM "import_task_rows"
      GROUP BY "idempotency_key"
      HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION 'duplicate import_task_rows idempotency keys found';
    END IF;

    ALTER TABLE "import_task_rows"
      ALTER COLUMN "idempotency_key" SET NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS "import_task_rows_idempotency_key_key"
      ON "import_task_rows"("idempotency_key");
  END IF;
END
$$;

COMMIT;
