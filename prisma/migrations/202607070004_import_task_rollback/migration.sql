ALTER TABLE "import_tasks" ADD COLUMN "rolled_back_at" TIMESTAMP(3);
ALTER TABLE "import_tasks" ADD COLUMN "rollback_customers" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "import_tasks" ADD COLUMN "rollback_optometry_orders" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "import_tasks" ADD COLUMN "rollback_fitting_orders" INTEGER NOT NULL DEFAULT 0;