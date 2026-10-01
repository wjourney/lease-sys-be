#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if curl -sf http://127.0.0.1:3002/api/v1/health >/dev/null; then
  echo 'Port 3002 is occupied. Stop the previous test server before running tests.' >&2
  exit 1
fi
export DATABASE_URL="${DATABASE_URL:-mysql://root:lease_test_root_local_only@127.0.0.1:53306/lease_test}"
# Tests reset their database. Refuse production hosts, ports and schema names.
node -e 'const url = new URL(process.env.DATABASE_URL); if (url.protocol !== "mysql:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !["13306", "53306"].includes(url.port) || !["lease_test", "lease_sys_test"].includes(url.pathname.slice(1))) process.exit(1)' || {
  echo 'Refusing to reset a database outside the dedicated local test schema.' >&2
  exit 1
}
export PORT=3002
export APP_ORIGIN='http://127.0.0.1:5174,http://localhost:5174'
export JWT_SECRET='lease-test-only-secret-never-use-in-production'
export SEED_PASSWORD='ChangeMe123!'
export TEST_API_URL='http://127.0.0.1:3002/api/v1'
export UPLOAD_DIR="$(mktemp -d /tmp/lease-test-uploads.XXXXXX)"
lease_test_pid=""
cleanup() {
  local result=$?
  trap - EXIT
  if [[ -n "$lease_test_pid" ]]; then
    kill "$lease_test_pid" 2>/dev/null || true
    wait "$lease_test_pid" 2>/dev/null || true
  fi
  if ! node node_modules/prisma/build/index.js migrate reset --force --skip-seed > /tmp/lease-test-cleanup.log 2>&1 || ! node node_modules/tsx/dist/cli.mjs prisma/seed.ts >> /tmp/lease-test-cleanup.log 2>&1; then
    echo 'Test database cleanup failed; see /tmp/lease-test-cleanup.log' >&2
    result=1
  fi
  rm -r -- "$UPLOAD_DIR"
  exit "$result"
}
trap cleanup EXIT
node node_modules/prisma/build/index.js migrate reset --force --skip-seed
node node_modules/tsx/dist/cli.mjs test/fixtures.seed.ts
node node_modules/typescript/bin/tsc -p tsconfig.json
node dist/main.js > /tmp/lease-integration-server.log 2>&1 &
lease_test_pid=$!
for attempt in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3002/api/v1/health >/dev/null; then break; fi
  sleep 1
done
if [[ "${1:-}" == "--serve" ]]; then
  echo 'Test API ready at http://127.0.0.1:3002; stop with Ctrl+C.'
  wait "$lease_test_pid"
else
  node node_modules/tsx/dist/cli.mjs --test test/*.test.ts
fi
