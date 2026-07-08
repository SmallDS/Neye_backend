#!/bin/sh
set -eu

if [ "${RUN_DB_PUSH:-true}" = "true" ]; then
  echo "[neye-api] syncing database schema with prisma db push"
  pnpm prisma db push
fi

if [ "${RUN_DB_SEED:-true}" = "true" ]; then
  echo "[neye-api] running prisma seed"
  pnpm prisma db seed
fi

echo "[neye-api] starting api"
exec "$@"