#!/bin/sh
set -eu

project_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
test_dir="${TMPDIR:-/tmp}/neye-db-test-$$"
bin_dir="$test_dir/bin"
log_file="$test_dir/commands.log"

cleanup() {
  rm -rf "$test_dir"
}
trap cleanup EXIT INT TERM

mkdir -p "$bin_dir"

cat > "$bin_dir/pnpm" <<'EOF'
#!/bin/sh
printf 'pnpm %s\n' "$*" >> "$NEYE_DB_TEST_LOG"
EOF

chmod +x "$bin_dir/pnpm"
export PATH="$bin_dir:$PATH"
export NEYE_DB_TEST_LOG="$log_file"
export NEYE_APP_DIR="$project_dir"

run_case() {
  : > "$log_file"
  sh "$project_dir/scripts/neye-db.sh" "$1" >/dev/null
}

assert_log() {
  expected="$1"
  actual="$(cat "$log_file")"
  if [ "$actual" != "$expected" ]; then
    printf 'expected:\n%s\nactual:\n%s\n' "$expected" "$actual" >&2
    exit 1
  fi
}

run_case init
assert_log 'pnpm prisma db push
pnpm db:seed'

run_case update
assert_log 'pnpm prisma db execute --file prisma/manual-updates/20260719_import_task_row_idempotency.sql --schema prisma/schema.prisma
pnpm prisma db push'

run_case backfill
assert_log 'pnpm db:backfill-user-tenants
pnpm db:backfill-customer-pinyin'

run_case status
assert_log 'pnpm db:migrate:status'

if sh "$project_dir/scripts/neye-db.sh" invalid >/dev/null 2>&1; then
  echo 'invalid neye-db command should fail' >&2
  exit 1
fi

echo 'database maintenance script tests passed'
