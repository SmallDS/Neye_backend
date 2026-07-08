CREATE TYPE "ImportTaskType" AS ENUM ('customer_optometry');
CREATE TYPE "ImportTaskStatus" AS ENUM ('pending', 'running', 'canceling', 'canceled', 'completed', 'failed');
CREATE TYPE "ImportTaskRowStatus" AS ENUM ('pending', 'success', 'failed', 'skipped');

CREATE TABLE "import_tasks" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_by_id" UUID NOT NULL,
  "type" "ImportTaskType" NOT NULL DEFAULT 'customer_optometry',
  "status" "ImportTaskStatus" NOT NULL DEFAULT 'pending',
  "file_name" VARCHAR(255) NOT NULL,
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "processed_rows" INTEGER NOT NULL DEFAULT 0,
  "success_rows" INTEGER NOT NULL DEFAULT 0,
  "failed_rows" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "cancel_requested_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "import_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "import_task_rows" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "row_no" INTEGER NOT NULL,
  "import_customer_no" VARCHAR(80),
  "status" "ImportTaskRowStatus" NOT NULL DEFAULT 'pending',
  "customer_id" UUID,
  "optometry_order_id" UUID,
  "error_message" TEXT,
  "raw_data" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "import_task_rows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "import_tasks_tenant_id_status_created_at_idx" ON "import_tasks"("tenant_id", "status", "created_at");
CREATE INDEX "import_tasks_created_by_id_idx" ON "import_tasks"("created_by_id");
CREATE UNIQUE INDEX "import_task_rows_task_id_row_no_key" ON "import_task_rows"("task_id", "row_no");
CREATE INDEX "import_task_rows_task_id_status_idx" ON "import_task_rows"("task_id", "status");
CREATE INDEX "import_task_rows_import_customer_no_idx" ON "import_task_rows"("import_customer_no");

ALTER TABLE "import_tasks" ADD CONSTRAINT "import_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_tasks" ADD CONSTRAINT "import_tasks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_task_rows" ADD CONSTRAINT "import_task_rows_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "import_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;