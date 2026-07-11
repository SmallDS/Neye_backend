CREATE TABLE "user_tenants" (
  "user_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_tenants_pkey" PRIMARY KEY ("user_id", "tenant_id")
);

INSERT INTO "user_tenants" ("user_id", "tenant_id")
SELECT "id", "tenant_id"
FROM "users"
WHERE "tenant_id" IS NOT NULL
ON CONFLICT ("user_id", "tenant_id") DO NOTHING;

UPDATE "users"
SET "tenant_id" = NULL
WHERE "tenant_id" IS NOT NULL;

CREATE INDEX "user_tenants_tenant_id_assigned_at_idx"
  ON "user_tenants"("tenant_id", "assigned_at");

ALTER TABLE "user_tenants"
  ADD CONSTRAINT "user_tenants_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_tenants"
  ADD CONSTRAINT "user_tenants_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;