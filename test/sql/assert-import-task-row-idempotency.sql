DO $$
DECLARE
  total_rows INTEGER;
  filled_rows INTEGER;
  distinct_keys INTEGER;
  column_length INTEGER;
  column_nullable TEXT;
BEGIN
  SELECT
    COUNT(*),
    COUNT("idempotency_key"),
    COUNT(DISTINCT "idempotency_key")
  INTO total_rows, filled_rows, distinct_keys
  FROM "import_task_rows";

  IF total_rows <> 139 OR filled_rows <> 139 OR distinct_keys <> 139 THEN
    RAISE EXCEPTION 'legacy idempotency backfill counts are invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "import_task_rows"
    WHERE "idempotency_key" <> "task_id"::text || ':' || "row_no"::text
  ) THEN
    RAISE EXCEPTION 'legacy idempotency backfill values are invalid';
  END IF;

  SELECT character_maximum_length, is_nullable
  INTO column_length, column_nullable
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'import_task_rows'
    AND column_name = 'idempotency_key';

  IF column_length <> 100 OR column_nullable <> 'NO' THEN
    RAISE EXCEPTION 'idempotency_key column constraint is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'import_task_rows'
      AND indexname = 'import_task_rows_idempotency_key_key'
      AND indexdef LIKE 'CREATE UNIQUE INDEX%'
  ) THEN
    RAISE EXCEPTION 'idempotency_key unique index is missing';
  END IF;

  BEGIN
    INSERT INTO "import_task_rows" ("task_id", "row_no", "idempotency_key")
    VALUES (2, 1, '1:1');
    RAISE EXCEPTION 'duplicate idempotency_key was accepted';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END
$$;

DROP TABLE "import_task_rows";
