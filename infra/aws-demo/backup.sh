#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env.aws-demo}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

DATA_ROOT="${QUERYMIND_DATA_ROOT:-/mnt/querymind}"
BACKUP_ROOT="${BACKUP_ROOT:-$DATA_ROOT/backup}"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT_DIR="$BACKUP_ROOT/$STAMP"

mkdir -p "$OUT_DIR"

cd "$SCRIPT_DIR"

POSTGRES_USER="${POSTGRES_USER:-qm_user}"
APP_DB="${QUERYMIND_APP_DB:-querymind}"
META_DB="${QUERYMIND_META_DB:-querymind_meta}"

docker compose --env-file "$ENV_FILE" -f docker-compose.aws-demo.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$META_DB" | gzip > "$OUT_DIR/${META_DB}.sql.gz"

docker compose --env-file "$ENV_FILE" -f docker-compose.aws-demo.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$APP_DB" | gzip > "$OUT_DIR/${APP_DB}.sql.gz"

if [ -d "$DATA_ROOT/storage" ]; then
  tar -C "$DATA_ROOT" -czf "$OUT_DIR/storage.tar.gz" storage
fi

cat > "$OUT_DIR/manifest.txt" <<EOF
created_at=$STAMP
data_root=$DATA_ROOT
postgres_user=$POSTGRES_USER
app_db=$APP_DB
meta_db=$META_DB
EOF

echo "Backup written to $OUT_DIR"
