#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env.aws-demo}"
BACKUP_DIR=""
YES="0"

usage() {
  cat <<'EOF'
Usage: bash infra/aws-demo/restore.sh --backup-dir PATH --yes

Restores querymind_meta, querymind, and storage.tar.gz from a backup directory
created by infra/aws-demo/backup.sh.

Options:
  --backup-dir PATH  Backup directory containing *.sql.gz files.
  --yes              Required confirmation for destructive restore.
  -h, --help         Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --backup-dir)
      BACKUP_DIR="$2"
      shift 2
      ;;
    --yes)
      YES="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ "$YES" != "1" ]; then
  echo "Refusing destructive restore without --yes." >&2
  exit 1
fi

if [ -z "$BACKUP_DIR" ] || [ ! -d "$BACKUP_DIR" ]; then
  echo "Missing or invalid --backup-dir." >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

DATA_ROOT="${QUERYMIND_DATA_ROOT:-/mnt/querymind}"
POSTGRES_USER="${POSTGRES_USER:-qm_user}"
APP_DB="${QUERYMIND_APP_DB:-querymind}"
META_DB="${QUERYMIND_META_DB:-querymind_meta}"

META_DUMP="$BACKUP_DIR/${META_DB}.sql.gz"
APP_DUMP="$BACKUP_DIR/${APP_DB}.sql.gz"

if [ ! -f "$META_DUMP" ] || [ ! -f "$APP_DUMP" ]; then
  echo "Expected dumps not found: $META_DUMP and $APP_DUMP" >&2
  exit 1
fi

cd "$SCRIPT_DIR"

docker compose --env-file "$ENV_FILE" -f docker-compose.aws-demo.yml exec -T postgres \
  dropdb -U "$POSTGRES_USER" --if-exists "$META_DB"
docker compose --env-file "$ENV_FILE" -f docker-compose.aws-demo.yml exec -T postgres \
  createdb -U "$POSTGRES_USER" "$META_DB"
gunzip -c "$META_DUMP" | docker compose --env-file "$ENV_FILE" -f docker-compose.aws-demo.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$META_DB"

docker compose --env-file "$ENV_FILE" -f docker-compose.aws-demo.yml exec -T postgres \
  dropdb -U "$POSTGRES_USER" --if-exists "$APP_DB"
docker compose --env-file "$ENV_FILE" -f docker-compose.aws-demo.yml exec -T postgres \
  createdb -U "$POSTGRES_USER" "$APP_DB"
gunzip -c "$APP_DUMP" | docker compose --env-file "$ENV_FILE" -f docker-compose.aws-demo.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$APP_DB"

if [ -f "$BACKUP_DIR/storage.tar.gz" ]; then
  mkdir -p "$DATA_ROOT"
  tar -C "$DATA_ROOT" -xzf "$BACKUP_DIR/storage.tar.gz"
fi

echo "Restore complete from $BACKUP_DIR"
