-- Enforce that related business records always belong to the same tenant.
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_id_tenant_id_key" UNIQUE ("id", "tenant_id");

ALTER TABLE "optometry_orders"
  ADD CONSTRAINT "optometry_orders_id_tenant_id_key" UNIQUE ("id", "tenant_id");

ALTER TABLE "fitting_orders"
  ADD CONSTRAINT "fitting_orders_id_tenant_id_key" UNIQUE ("id", "tenant_id");

ALTER TABLE "optometry_orders"
  DROP CONSTRAINT IF EXISTS "optometry_orders_customer_id_fkey";

ALTER TABLE "optometry_orders"
  ADD CONSTRAINT "optometry_orders_customer_id_tenant_id_fkey"
  FOREIGN KEY ("customer_id", "tenant_id")
  REFERENCES "customers"("id", "tenant_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "fitting_orders"
  DROP CONSTRAINT IF EXISTS "fitting_orders_customer_id_fkey";

ALTER TABLE "fitting_orders"
  DROP CONSTRAINT IF EXISTS "fitting_orders_optometry_order_id_fkey";

ALTER TABLE "fitting_orders"
  ADD CONSTRAINT "fitting_orders_customer_id_tenant_id_fkey"
  FOREIGN KEY ("customer_id", "tenant_id")
  REFERENCES "customers"("id", "tenant_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "fitting_orders"
  ADD CONSTRAINT "fitting_orders_optometry_order_id_tenant_id_fkey"
  FOREIGN KEY ("optometry_order_id", "tenant_id")
  REFERENCES "optometry_orders"("id", "tenant_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;