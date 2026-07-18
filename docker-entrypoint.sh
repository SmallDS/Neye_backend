#!/bin/sh
set -eu

if [ "${RUN_DB_MIGRATIONS:-false}" = "true" ] && [ "${RUN_DB_PUSH:-false}" = "true" ]; then
  echo "[neye-api] RUN_DB_MIGRATIONS and RUN_DB_PUSH cannot both be enabled" >&2
  exit 1
fi

if [ "${RUN_DB_MIGRATIONS:-false}" = "true" ]; then
  echo "[neye-api] applying reviewed Prisma migrations"
  pnpm db:migrate:deploy
elif [ "${RUN_DB_PUSH:-false}" = "true" ]; then
  if [ "${ALLOW_UNSAFE_DB_PUSH:-false}" != "true" ]; then
    echo "[neye-api] refusing prisma db push without ALLOW_UNSAFE_DB_PUSH=true" >&2
    exit 1
  fi
  echo "[neye-api] running explicitly authorized prisma db push"
  if [ "${RUN_DB_PUSH_ACCEPT_DATA_LOSS:-false}" = "true" ]; then
    echo "[neye-api] prisma data-loss warnings are explicitly accepted"
    pnpm prisma db push --accept-data-loss
  else
    pnpm prisma db push
  fi
else
  echo "[neye-api] database schema changes skipped; run them as a separate release job"
fi

if [ "${RUN_USER_TENANT_BACKFILL:-false}" = "true" ]; then
  echo "[neye-api] backfilling user-tenant memberships"
  pnpm db:backfill-user-tenants
fi
if [ "${RUN_CUSTOMER_PINYIN_BACKFILL:-false}" = "true" ]; then
  echo "[neye-api] backfilling customer Pinyin search fields"
  pnpm db:backfill-customer-pinyin
fi

if [ "${RUN_DB_SEED:-false}" = "true" ]; then
  echo "[neye-api] running prisma seed"
  pnpm prisma db seed
fi

echo "[neye-api] starting api"
exec "$@"
