#!/usr/bin/env bash
set -euo pipefail

DATA_ROOT="${QUERYMIND_DATA_ROOT:-/mnt/querymind}"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This bootstrap script expects Ubuntu/Debian with apt-get." >&2
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this script as the login user, not as root. It will use sudo when needed." >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git

if ! command -v docker >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  . /etc/os-release
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

sudo systemctl enable --now docker

if ! id -nG "$USER" | tr ' ' '\n' | grep -qx docker; then
  sudo usermod -aG docker "$USER"
  echo "Added $USER to docker group. Log out and back in before running docker without sudo."
fi

sudo mkdir -p \
  "$DATA_ROOT/postgres-data" \
  "$DATA_ROOT/app-data" \
  "$DATA_ROOT/storage" \
  "$DATA_ROOT/backup/dumps"
sudo chown -R "$USER":"$USER" "$DATA_ROOT"

docker --version || sudo docker --version
docker compose version || sudo docker compose version

cat <<EOF
Bootstrap complete.

Data root: $DATA_ROOT

Next:
  cd infra/aws-demo
  cp .env.aws-demo.example .env.aws-demo
  edit .env.aws-demo
  python ../../scripts/aws_demo_preflight.py --env-file .env.aws-demo
EOF
