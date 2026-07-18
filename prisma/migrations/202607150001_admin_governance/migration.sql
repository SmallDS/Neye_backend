ALTER TABLE "import_tasks"
ADD COLUMN "lease_owner" VARCHAR(128),
ADD COLUMN "lease_expires_at" TIMESTAMP(3),
ADD COLUMN "heartbeat_at" TIMESTAMP(3);

ALTER TABLE "import_task_rows"
ADD COLUMN "idempotency_key" VARCHAR(100);

UPDATE "import_task_rows"
SET "idempotency_key" = "task_id"::text || ':' || "row_no"::text
WHERE "idempotency_key" IS NULL;

ALTER TABLE "import_task_rows"
ALTER COLUMN "idempotency_key" SET NOT NULL;

CREATE UNIQUE INDEX "import_task_rows_idempotency_key_key"
ON "import_task_rows"("idempotency_key");

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL,
  "actor_user_id" UUID,
  "actor_username" VARCHAR(80),
  "tenant_id" UUID,
  "action" VARCHAR(80) NOT NULL,
  "resource_type" VARCHAR(80) NOT NULL,
  "resource_id" VARCHAR(120),
  "reason" VARCHAR(500),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");
CREATE INDEX "audit_logs_resource_type_resource_id_created_at_idx" ON "audit_logs"("resource_type", "resource_id", "created_at");
ALTER TABLE "import_tasks"
ADD COLUMN "idempotency_key" UUID;

CREATE UNIQUE INDEX "import_tasks_tenant_id_idempotency_key_key"
ON "import_tasks"("tenant_id", "idempotency_key");