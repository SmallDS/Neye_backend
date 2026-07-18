CREATE TYPE "ImportTaskPhase" AS ENUM ('uploaded', 'parsing', 'processing', 'publishing', 'cleanup', 'finished');

ALTER TABLE "import_tasks"
ADD COLUMN "phase" "ImportTaskPhase" NOT NULL DEFAULT 'uploaded',
ADD COLUMN "staged_rows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "last_staged_row_no" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "last_processed_row_no" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "published_at" TIMESTAMP(3);

ALTER TABLE "customers" ADD COLUMN "import_task_id" UUID;
ALTER TABLE "optometry_orders" ADD COLUMN "import_task_id" UUID;

CREATE TABLE "import_task_sources" (
  "task_id" UUID NOT NULL,
  "content" BYTEA,
  "mime_type" VARCHAR(160) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "purged_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "import_task_sources_pkey" PRIMARY KEY ("task_id")
);

UPDATE "import_tasks"
SET "phase" = 'finished'
WHERE "status" IN ('completed', 'failed', 'canceled');

UPDATE "import_tasks"
SET "phase" = 'processing',
    "staged_rows" = (SELECT COUNT(*) FROM "import_task_rows" r WHERE r."task_id" = "import_tasks"."id"),
    "last_staged_row_no" = COALESCE((SELECT MAX(r."row_no") FROM "import_task_rows" r WHERE r."task_id" = "import_tasks"."id"), 0),
    "last_processed_row_no" = COALESCE((SELECT MAX(r."row_no") FROM "import_task_rows" r WHERE r."task_id" = "import_tasks"."id" AND r."status" <> 'pending'), 0)
WHERE "status" IN ('pending', 'running', 'canceling')
  AND EXISTS (SELECT 1 FROM "import_task_rows" r WHERE r."task_id" = "import_tasks"."id");

UPDATE "import_tasks"
SET "status" = 'failed',
    "phase" = 'finished',
    "finished_at" = COALESCE("finished_at", CURRENT_TIMESTAMP),
    "error_message" = COALESCE("error_message", 'Legacy unfinished import has no recoverable source or staged rows'),
    "lease_owner" = NULL,
    "lease_expires_at" = NULL
WHERE "status" IN ('pending', 'running', 'canceling')
  AND NOT EXISTS (SELECT 1 FROM "import_task_rows" r WHERE r."task_id" = "import_tasks"."id");

CREATE INDEX "customers_import_task_id_idx" ON "customers"("import_task_id");
CREATE INDEX "optometry_orders_import_task_id_idx" ON "optometry_orders"("import_task_id");
CREATE INDEX "import_task_sources_sha256_idx" ON "import_task_sources"("sha256");

ALTER TABLE "customers" ADD CONSTRAINT "customers_import_task_id_fkey" FOREIGN KEY ("import_task_id") REFERENCES "import_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "optometry_orders" ADD CONSTRAINT "optometry_orders_import_task_id_fkey" FOREIGN KEY ("import_task_id") REFERENCES "import_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "import_task_sources" ADD CONSTRAINT "import_task_sources_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "import_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;