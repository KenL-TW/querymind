#!/bin/sh
set -eu

APP_DB="${QUERYMIND_APP_DB:-querymind}"
META_DB="${QUERYMIND_META_DB:-querymind_meta}"
OWNER="${POSTGRES_USER:-qm_user}"
BOOTSTRAP_DB="${POSTGRES_DB:-$APP_DB}"

create_db_if_missing() {
  db_name="$1"
  exists="$(psql -U "$OWNER" -d "$BOOTSTRAP_DB" -tAc "SELECT 1 FROM pg_database WHERE datname = '$db_name'")"
  if [ "$exists" != "1" ]; then
    psql -U "$OWNER" -d "$BOOTSTRAP_DB" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db_name\" OWNER \"$OWNER\";"
  fi
}

create_db_if_missing "$APP_DB"
create_db_if_missing "$META_DB"
