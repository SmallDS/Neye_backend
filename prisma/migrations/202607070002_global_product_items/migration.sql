-- Make product dictionary global across all tenants.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE t.relname = 'product_items'
      AND a.attname = 'tenant_id'
      AND c.contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE "product_items" DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;
END $$;

DROP INDEX IF EXISTS "product_items_tenant_id_category_name_idx";
DROP INDEX IF EXISTS "product_items_tenant_id_category_usage_count_idx";
DROP INDEX IF EXISTS "product_items_tenant_id_idx";

ALTER TABLE "product_items" DROP COLUMN IF EXISTS "tenant_id";

CREATE INDEX IF NOT EXISTS "product_items_category_name_idx" ON "product_items"("category", "name");
CREATE INDEX IF NOT EXISTS "product_items_category_usage_count_idx" ON "product_items"("category", "usage_count");