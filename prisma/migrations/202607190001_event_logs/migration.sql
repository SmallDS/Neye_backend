CREATE TYPE "EventLogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');
CREATE TYPE "EventLogCategory" AS ENUM ('AUDIT', 'SECURITY', 'SYSTEM');
CREATE TYPE "EventLogResult" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

CREATE TABLE "event_logs" (
  "id" UUID NOT NULL,
  "level" "EventLogLevel" NOT NULL,
  "category" "EventLogCategory" NOT NULL,
  "result" "EventLogResult" NOT NULL,
  "module" VARCHAR(80) NOT NULL,
  "action" VARCHAR(80) NOT NULL,
  "actor_user_id" UUID,
  "actor_username" VARCHAR(80),
  "tenant_id" UUID,
  "resource_type" VARCHAR(80),
  "resource_id" VARCHAR(160),
  "request_id" VARCHAR(128),
  "ip_address" VARCHAR(64),
  "reason" TEXT,
  "error_summary" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "event_logs_created_at_idx" ON "event_logs"("created_at");
CREATE INDEX "event_logs_level_created_at_idx" ON "event_logs"("level", "created_at");
CREATE INDEX "event_logs_tenant_id_created_at_idx" ON "event_logs"("tenant_id", "created_at");
CREATE INDEX "event_logs_actor_user_id_created_at_idx" ON "event_logs"("actor_user_id", "created_at");
CREATE INDEX "event_logs_resource_type_resource_id_created_at_idx" ON "event_logs"("resource_type", "resource_id", "created_at");
CREATE INDEX "event_logs_request_id_idx" ON "event_logs"("request_id");