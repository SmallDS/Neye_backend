-- Add normalized customer name search fields for full Pinyin and initials.
ALTER TABLE "customers"
  ADD COLUMN "name_pinyin" VARCHAR(512),
  ADD COLUMN "name_initials" VARCHAR(80);

CREATE INDEX "customers_tenant_id_name_pinyin_idx"
  ON "customers"("tenant_id", "name_pinyin");

CREATE INDEX "customers_tenant_id_name_initials_idx"
  ON "customers"("tenant_id", "name_initials");