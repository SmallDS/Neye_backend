#!/bin/sh
set -eu

app_dir="${NEYE_APP_DIR:-/app}"

usage() {
  cat <<'EOF'
Usage: neye-db <command>

Commands:
  init      Create the schema for a new empty database and seed the administrator
  update    Run reviewed manual data updates, then safely synchronize the schema
  backfill  Run the idempotent application data backfills
  status    Show Prisma migration status
EOF
}

run_manual_updates() {
  for sql_file in prisma/manual-updates/*.sql; do
    [ -f "$sql_file" ] || continue
    echo "[neye-db] applying manual update: $sql_file"
    pnpm prisma db execute --file "$sql_file" --schema prisma/schema.prisma
  done
}

cd "$app_dir"

case "${1:-}" in
  init)
    echo "[neye-db] initializing an empty database"
    pnpm prisma db push
    pnpm db:seed
    ;;
  update)
    echo "[neye-db] applying reviewed database updates"
    run_manual_updates
    pnpm prisma db push
    ;;
  backfill)
    echo "[neye-db] running idempotent data backfills"
    pnpm db:backfill-user-tenants
    pnpm db:backfill-customer-pinyin
    ;;
  status)
    pnpm db:migrate:status
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
