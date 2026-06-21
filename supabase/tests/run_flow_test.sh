#!/usr/bin/env bash
# Verify the full PhotoBooth data flow against a real Postgres, with the actual migrations applied.
# Spins up a disposable cluster (no Docker / hosted Supabase needed), runs the flow + security
# checks, and tears everything down. Requires a local PostgreSQL 16 (`initdb`, `pg_ctl`, `psql`).
#
#   ./supabase/tests/run_flow_test.sh
set -euo pipefail

export LANG=C LC_ALL=C
# Prefer Homebrew postgresql@16 if present.
if [ -d /opt/homebrew/opt/postgresql@16/bin ]; then
  export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
MIGR="$HERE/../migrations"
PGDIR="$(mktemp -d "${TMPDIR:-/tmp}/pb-flow-XXXXXX")"
PORT=55444
cleanup() { pg_ctl -D "$PGDIR" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$PGDIR"; }
trap cleanup EXIT

initdb -D "$PGDIR" -U postgres --auth=trust --locale=C >/dev/null
pg_ctl -D "$PGDIR" -o "-p $PORT -k $PGDIR -c listen_addresses=''" -l "$PGDIR/log" start >/dev/null
sleep 2

psql() { command psql -h "$PGDIR" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

echo "→ applying auth stub + migrations"
psql -q -f "$HERE/_auth_stub.sql" >/dev/null
for f in "$MIGR"/*.sql; do psql -q -f "$f" >/dev/null 2>&1; done
psql -q -c "grant select, insert, update, delete on all tables in schema public to app_user;
            grant execute on all functions in schema public to app_user;" >/dev/null

echo "→ running flow test"
psql -f "$HERE/flow_test.sql" 2>&1 | grep -E "PASS|PASSED|ERROR|exception"
