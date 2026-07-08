-- Merge system_admin and tenant_admin into admin while preserving staff.
-- Existing PostgreSQL enum values cannot be removed safely in-place, so tenant_admin
-- may remain as an unused enum value in already-created databases.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'UserRole' AND e.enumlabel = 'system_admin'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'UserRole' AND e.enumlabel = 'admin'
  ) THEN
    ALTER TYPE "UserRole" RENAME VALUE 'system_admin' TO 'admin';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'UserRole' AND e.enumlabel = 'admin'
  ) THEN
    ALTER TYPE "UserRole" ADD VALUE 'admin';
  END IF;
END $$;

UPDATE "users" SET "role" = 'admin' WHERE "role"::text IN ('system_admin', 'tenant_admin');