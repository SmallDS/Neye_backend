BEGIN;

CREATE TABLE "import_task_rows" (
  "id" BIGSERIAL PRIMARY KEY,
  "task_id" BIGINT NOT NULL,
  "row_no" INTEGER NOT NULL
);

CREATE UNIQUE INDEX "import_task_rows_task_id_row_no_key"
  ON "import_task_rows"("task_id", "row_no");

INSERT INTO "import_task_rows" ("task_id", "row_no")
SELECT 1, row_no
FROM generate_series(1, 139) AS row_no;

COMMIT;
