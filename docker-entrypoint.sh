#!/bin/sh
set -eu

if [ "${RUN_DB_MIGRATIONS:-false}" = "true" ]; then
  echo "[neye-api] applying prisma migrations"
  pnpm prisma migrate deploy
elif [ "${RUN_DB_PUSH:-true}" = "true" ]; then
  echo "[neye-api] syncing database schema with prisma db push"
  pnpm prisma db push
else
  echo "[neye-api] database schema sync skipped"
fi

if [ "${RUN_USER_TENANT_BACKFILL:-true}" = "true" ]; then
  echo "[neye-api] backfilling user-tenant memberships"
  pnpm db:backfill-user-tenants
fi
if [ "${RUN_CUSTOMER_PINYIN_BACKFILL:-true}" = "true" ]; then
  echo "[neye-api] backfilling customer Pinyin search fields"
  pnpm db:backfill-customer-pinyin
fi

if [ "${RUN_DB_SEED:-false}" = "true" ]; then
  echo "[neye-api] running prisma seed"
  pnpm prisma db seed
fi

echo "[neye-api] starting api"
exec "$@"