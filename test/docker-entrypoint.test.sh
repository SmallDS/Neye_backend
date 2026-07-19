#!/bin/sh
set -eu

project_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
test_dir="${TMPDIR:-/tmp}/neye-entrypoint-test-$$"
bin_dir="$test_dir/bin"
log_file="$test_dir/commands.log"

cleanup() {
  rm -rf "$test_dir"
}
trap cleanup EXIT INT TERM

mkdir -p "$bin_dir"

cat > "$bin_dir/pnpm" <<'EOF'
#!/bin/sh
printf 'pnpm %s\n' "$*" >> "$ENTRYPOINT_TEST_LOG"
EOF

cat > "$bin_dir/start-api" <<'EOF'
#!/bin/sh
printf 'start-api %s\n' "$*" >> "$ENTRYPOINT_TEST_LOG"
EOF

chmod +x "$bin_dir/pnpm" "$bin_dir/start-api"
export PATH="$bin_dir:$PATH"
export ENTRYPOINT_TEST_LOG="$log_file"

run_case() {
  : > "$log_file"
  DB_SETUP_MODE="$1" RUN_DB_BACKFILLS="${2:-false}" \
    sh "$project_dir/docker-entrypoint.sh" start-api ready >/dev/null
}

assert_log() {
  expected="$1"
  actual="$(cat "$log_file")"
  if [ "$actual" != "$expected" ]; then
    printf 'expected:\n%s\nactual:\n%s\n' "$expected" "$actual" >&2
    exit 1
  fi
}

run_case none
assert_log 'start-api ready'

run_case init
assert_log 'pnpm prisma db push
pnpm db:seed
start-api ready'

run_case update true
assert_log 'pnpm prisma db push
pnpm db:backfill-user-tenants
pnpm db:backfill-customer-pinyin
start-api ready'

run_case migrate
assert_log 'pnpm db:migrate:deploy
start-api ready'

if DB_SETUP_MODE=invalid sh "$project_dir/docker-entrypoint.sh" start-api ready >/dev/null 2>&1; then
  echo 'invalid DB_SETUP_MODE should fail' >&2
  exit 1
fi

echo 'docker entrypoint tests passed'
