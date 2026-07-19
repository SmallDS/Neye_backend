#!/bin/sh
set -eu

db_setup_mode="${DB_SETUP_MODE:-none}"

case "$db_setup_mode" in
  none)
    echo "[neye-api] database setup skipped"
    ;;
  init)
    echo "[neye-api] initializing database schema"
    pnpm prisma db push
    echo "[neye-api] creating the initial administrator"
    pnpm db:seed
    ;;
  update)
    echo "[neye-api] synchronizing reviewed schema changes"
    pnpm prisma db push
    ;;
  migrate)
    echo "[neye-api] applying reviewed Prisma migrations"
    pnpm db:migrate:deploy
    ;;
  *)
    echo "[neye-api] invalid DB_SETUP_MODE='$db_setup_mode'; expected none, init, update, or migrate" >&2
    exit 1
    ;;
esac

if [ "${RUN_DB_BACKFILLS:-false}" = "true" ]; then
  echo "[neye-api] running idempotent database backfills"
  pnpm db:backfill-user-tenants
  pnpm db:backfill-customer-pinyin
fi

echo "[neye-api] starting api"
exec "$@"
