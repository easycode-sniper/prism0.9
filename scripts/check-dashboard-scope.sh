#!/usr/bin/env bash
# Run migration 060's aggregates against a throwaway Postgres and assert
# what they return.
#
# WHY THIS EXISTS. Every other check in scripts/ is pure TypeScript,
# because everything else worth checking is. 060 is different: it is the
# first migration here whose SQL BRANCHES — the km column changes source
# when a scope is set — and the branch it does not take is the one the
# whole dashboard already depends on. A mistake there is a wrong number
# on the fleet's own page, not a missing feature.
#
# It also caught two real defects on its first run, neither of which any
# amount of reading would have shown: the migration was not replayable
# (it dropped the OLD signature only, so a second run failed with
# "already exists with same argument types"), and the scope picker
# labelled a tracker-only driver with the normalised key — "ABDELKADER
# ZEKRAOUI", token-sorted and shouting.
#
# Needs a local postgres (any recent version; developed against 16) and
# root, to su to an unprivileged user — Postgres refuses to run as root.
# It touches NOTHING outside its own temp cluster and no remote database.
#
#   bash scripts/check-dashboard-scope.sh      # or: npm run check:scope

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
if [ -z "$PGBIN" ]; then
  echo "SKIP: no local postgres found (/usr/lib/postgresql/*/bin)" >&2
  exit 0
fi
export PATH="$PGBIN:$PATH"

PGDIR="$(mktemp -d /tmp/prism-scope-check.XXXXXX)"
PORT="${PGPORT_CHECK:-55432}"
cleanup() {
  su postgres -c "PATH=$PGBIN:\$PATH pg_ctl -D $PGDIR/data -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$PGDIR"
}
trap cleanup EXIT

cp "$ROOT/supabase/migrations/060_dashboard_scope.sql" "$PGDIR/060.sql"
cp "$ROOT/scripts/sql/dashboard-scope-fixture.sql"     "$PGDIR/fixture.sql"
cp "$ROOT/scripts/sql/dashboard-scope-assert.sql"      "$PGDIR/assert.sql"
chown -R postgres:postgres "$PGDIR"

psqlq() { su postgres -c "PATH=$PGBIN:\$PATH psql -h $PGDIR -p $PORT -U postgres -v ON_ERROR_STOP=1 $*"; }

su postgres -c "PATH=$PGBIN:\$PATH initdb -U postgres -A trust -D $PGDIR/data" >"$PGDIR/initdb.log" 2>&1
su postgres -c "PATH=$PGBIN:\$PATH pg_ctl -D $PGDIR/data -o '-p $PORT -k $PGDIR -c listen_addresses=' -l $PGDIR/pg.log start" >/dev/null 2>&1
for _ in $(seq 1 20); do
  su postgres -c "PATH=$PGBIN:\$PATH pg_isready -h $PGDIR -p $PORT" >/dev/null 2>&1 && break
  sleep 0.5
done

psqlq "-q -c 'CREATE ROLE authenticated;'" >/dev/null
psqlq "-q -f $PGDIR/fixture.sql" >/dev/null
echo "schema + fixture loaded"

# Applied three times: the migration must be replayable, which is exactly
# what it was not when this script was written.
for i in 1 2 3; do
  psqlq "-q -f $PGDIR/060.sql" 2>&1 | grep -vi 'notice' || true
  echo "migration 060 applied (pass $i)"
done

echo
OUT="$(psqlq "-f $PGDIR/assert.sql" 2>&1)"
echo "$OUT" | grep -E '^(norm|fleet|truck|driver|speeding|scope|misspelling|stations)' || true
echo
echo "$OUT" | grep -A20 'scope options as the picker' || true

# ── The TS normaliser must agree with the SQL one ────────────────────
#
# scope.ts implements norm_driver_name() a second time, in TypeScript,
# because the variance tables are filtered on the client. Two copies of
# one rule drift; this is what stops that being silent.
echo
echo "--- normalizeDriverKey (TS) vs norm_driver_name (SQL) ---"
node --experimental-strip-types "$ROOT/scripts/check-driver-key.mts" 2>/dev/null > "$PGDIR/ts.tsv"

# Same list, same order, through Postgres. Formatting comes from psql's
# command-line flags (-A -t -F) rather than \pset, which echoes a banner
# line into stdout and lands in the diff as a phantom difference.
: > "$PGDIR/names.sql"
while IFS= read -r name; do
  [ -z "$name" ] && continue
  esc="${name//\'/\'\'}"
  printf "SELECT COALESCE(public.norm_driver_name(%s), '');\n" "'$esc'" >> "$PGDIR/names.sql"
done < "$ROOT/scripts/sql/driver-name-samples.txt"
chown postgres:postgres "$PGDIR/names.sql"
psqlq "-A -t -f $PGDIR/names.sql" > "$PGDIR/sql.keys" 2>/dev/null
cut -f2 "$PGDIR/ts.tsv" > "$PGDIR/ts.keys"

NORM_FAILS=0
if diff -u "$PGDIR/ts.keys" "$PGDIR/sql.keys" > "$PGDIR/norm.diff"; then
  echo "PASS  TS and SQL normalisers agree on all $(wc -l < "$PGDIR/ts.keys") names"
else
  echo "FAIL  TS and SQL normalisers DISAGREE (TS left, SQL right):"
  paste "$PGDIR/ts.tsv" "$PGDIR/sql.keys" | awk -F"\t" '$2 != $3 { print "    " $1 "  TS=[" $2 "]  SQL=[" $3 "]" }' 
  NORM_FAILS=1
fi

FAILS="$(echo "$OUT" | grep -c 'FAIL' || true)"
FAILS=$((FAILS + NORM_FAILS))
echo
if [ "$FAILS" -eq 0 ]; then
  echo "All dashboard-scope SQL checks passed."
else
  echo "$FAILS check(s) FAILED."
  exit 1
fi
