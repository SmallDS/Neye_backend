CREATE TABLE IF NOT EXISTS "system_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(80) NOT NULL,
  "value" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "system_settings_key_key" ON "system_settings"("key");