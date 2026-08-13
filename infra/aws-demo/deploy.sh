#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.aws-demo"
BUILD_FLAG="--build"
RUN_SEED="1"
RUN_PREFLIGHT="1"
SMOKE_BASE_URL=""
INCLUDE_CHAT_SMOKE=""

usage() {
  cat <<'EOF'
Usage: bash infra/aws-demo/deploy.sh [options]

Options:
  --env-file PATH          Env file to use. Default: infra/aws-demo/.env.aws-demo
  --no-build              Do not rebuild images.
  --skip-seed             Do not run metadata/demo seed commands.
  --skip-preflight        Do not run aws_demo_preflight.py.
  --smoke-base-url URL    Run aws_demo_smoke_test.py after deploy.
  --include-chat-smoke    Include /v1/chat/sync in smoke test. May incur LLM cost.
  -h, --help              Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --no-build)
      BUILD_FLAG=""
      shift
      ;;
    --skip-seed)
      RUN_SEED="0"
      shift
      ;;
    --skip-preflight)
      RUN_PREFLIGHT="0"
      shift
      ;;
    --smoke-base-url)
      SMOKE_BASE_URL="$2"
      shift 2
      ;;
    --include-chat-smoke)
      INCLUDE_CHAT_SMOKE="--include-chat"
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

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  echo "Create it with: cp infra/aws-demo/.env.aws-demo.example infra/aws-demo/.env.aws-demo" >&2
  exit 1
fi

export QUERYMIND_ENV_FILE="$ENV_FILE"

cd "$SCRIPT_DIR"

if [ "$RUN_PREFLIGHT" = "1" ]; then
  python "$REPO_ROOT/scripts/aws_demo_preflight.py" --env-file "$ENV_FILE" --skip-build-checks
fi

docker compose --env-file "$ENV_FILE" -f docker-compose.aws-demo.yml up -d ${BUILD_FLAG}
docker compose --env-file "$ENV_FILE" -f docker-compose.aws-demo.yml ps

if [ "$RUN_SEED" = "1" ]; then
  docker compose --env-file "$ENV_FILE" -f docker-compose.aws-demo.yml exec api python infra/scripts/init_meta_db.py
  docker compose --env-file "$ENV_FILE" -f docker-compose.aws-demo.yml exec api python infra/scripts/seed_metadata.py
  docker compose --env-file "$ENV_FILE" -f docker-compose.aws-demo.yml exec api python seed_full_schema.py
fi

if [ -n "$SMOKE_BASE_URL" ]; then
  python "$REPO_ROOT/scripts/aws_demo_smoke_test.py" --base-url "$SMOKE_BASE_URL" ${INCLUDE_CHAT_SMOKE}
else
  cat <<EOF
Deploy complete.

Run smoke test:
  python scripts/aws_demo_smoke_test.py --base-url http://<EC2_PUBLIC_DNS_OR_IP>
EOF
fi
