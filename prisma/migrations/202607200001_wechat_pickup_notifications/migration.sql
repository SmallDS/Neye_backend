CREATE TYPE "PickupNotificationTaskStatus" AS ENUM ('pending', 'processing', 'retrying', 'sent', 'failed');
CREATE TYPE "PickupNotificationAttemptResult" AS ENUM ('processing', 'sent', 'temporary_failure', 'permanent_failure');

ALTER TABLE "fitting_orders" ADD COLUMN "ready_for_pickup_at" TIMESTAMP(3);

CREATE TABLE "fitting_pickup_scenes" (
  "id" UUID NOT NULL,
  "fitting_order_id" UUID NOT NULL,
  "scene" VARCHAR(32) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fitting_pickup_scenes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fitting_pickup_subscriptions" (
  "id" UUID NOT NULL,
  "fitting_order_id" UUID NOT NULL,
  "app_id" VARCHAR(64) NOT NULL,
  "open_id" VARCHAR(128) NOT NULL,
  "template_id" VARCHAR(128) NOT NULL,
  "keyword_mapping" JSONB NOT NULL,
  "pickup_tip" VARCHAR(200) NOT NULL,
  "subscribed_at" TIMESTAMP(3) NOT NULL,
  "locked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fitting_pickup_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pickup_notification_tasks" (
  "id" UUID NOT NULL,
  "fitting_order_id" UUID NOT NULL,
  "subscription_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "status" "PickupNotificationTaskStatus" NOT NULL DEFAULT 'pending',
  "cycle" INTEGER NOT NULL DEFAULT 1,
  "attempt_in_cycle" INTEGER NOT NULL DEFAULT 0,
  "total_attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_owner" VARCHAR(128),
  "lease_expires_at" TIMESTAMP(3),
  "last_error_code" VARCHAR(64),
  "last_error_summary" VARCHAR(500),
  "wechat_message_id" VARCHAR(128),
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pickup_notification_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pickup_notification_attempts" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "cycle" INTEGER NOT NULL,
  "attempt_no" INTEGER NOT NULL,
  "result" "PickupNotificationAttemptResult" NOT NULL DEFAULT 'processing',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  "wechat_error_code" INTEGER,
  "error_code" VARCHAR(64),
  "error_summary" VARCHAR(500),
  "token_refreshed" BOOLEAN NOT NULL DEFAULT false,
  "next_retry_at" TIMESTAMP(3),
  CONSTRAINT "pickup_notification_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fitting_pickup_scenes_fitting_order_id_key" ON "fitting_pickup_scenes"("fitting_order_id");
CREATE UNIQUE INDEX "fitting_pickup_scenes_scene_key" ON "fitting_pickup_scenes"("scene");
CREATE INDEX "fitting_pickup_scenes_expires_at_idx" ON "fitting_pickup_scenes"("expires_at");
CREATE UNIQUE INDEX "fitting_pickup_subscriptions_fitting_order_id_key" ON "fitting_pickup_subscriptions"("fitting_order_id");
CREATE INDEX "fitting_pickup_subscriptions_locked_at_idx" ON "fitting_pickup_subscriptions"("locked_at");
CREATE UNIQUE INDEX "pickup_notification_tasks_fitting_order_id_key" ON "pickup_notification_tasks"("fitting_order_id");
CREATE UNIQUE INDEX "pickup_notification_tasks_subscription_id_key" ON "pickup_notification_tasks"("subscription_id");
CREATE INDEX "pickup_notification_tasks_status_next_attempt_at_idx" ON "pickup_notification_tasks"("status", "next_attempt_at");
CREATE INDEX "pickup_notification_tasks_status_lease_expires_at_idx" ON "pickup_notification_tasks"("status", "lease_expires_at");
CREATE INDEX "pickup_notification_tasks_tenant_id_status_created_at_idx" ON "pickup_notification_tasks"("tenant_id", "status", "created_at");
CREATE UNIQUE INDEX "pickup_notification_attempts_task_id_cycle_attempt_no_key" ON "pickup_notification_attempts"("task_id", "cycle", "attempt_no");
CREATE INDEX "pickup_notification_attempts_task_id_started_at_idx" ON "pickup_notification_attempts"("task_id", "started_at");
CREATE INDEX "fitting_orders_tenant_id_ready_for_pickup_at_idx" ON "fitting_orders"("tenant_id", "ready_for_pickup_at");

ALTER TABLE "fitting_pickup_scenes" ADD CONSTRAINT "fitting_pickup_scenes_fitting_order_id_fkey" FOREIGN KEY ("fitting_order_id") REFERENCES "fitting_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fitting_pickup_subscriptions" ADD CONSTRAINT "fitting_pickup_subscriptions_fitting_order_id_fkey" FOREIGN KEY ("fitting_order_id") REFERENCES "fitting_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pickup_notification_tasks" ADD CONSTRAINT "pickup_notification_tasks_fitting_order_id_fkey" FOREIGN KEY ("fitting_order_id") REFERENCES "fitting_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pickup_notification_tasks" ADD CONSTRAINT "pickup_notification_tasks_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "fitting_pickup_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pickup_notification_tasks" ADD CONSTRAINT "pickup_notification_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pickup_notification_attempts" ADD CONSTRAINT "pickup_notification_attempts_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "pickup_notification_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;