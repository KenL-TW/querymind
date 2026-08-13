# QueryMind AWS Demo Deployment

This folder is the first deployable AWS path for QueryMind. It targets the low-cost on-demand demo architecture described in `querymind_aws_demo_architecture.md`: one EC2 instance, one EBS-backed data root, Docker Compose, Nginx, FastAPI, Nuxt static assets, and PostgreSQL in a local container.

It is not the production SaaS target. Do not add RDS, ALB, ECS, NAT Gateway, Route 53, or CloudFront for the first demo unless the requirement changes.

## Services

`docker-compose.aws-demo.yml` starts:

- `postgres`: PostgreSQL 16, with `querymind` and `querymind_meta` databases.
- `api`: FastAPI on the internal Docker network at `api:8080`.
- `nginx`: public port `80`, serving the generated Nuxt SPA and proxying `/v1`, `/health`, `/docs`, and `/openapi.json` to FastAPI.

Persistent data is mounted under `QUERYMIND_DATA_ROOT`, defaulting to `/mnt/querymind`.

## EC2 Setup

Recommended first demo instance:

- Instance: `t4g.small` on Ubuntu 24.04 LTS ARM64.
- Disk: gp3 30 GB or larger.
- Access: AWS Systems Manager Session Manager if possible.
- Security group: open inbound `80` only during demo windows. Do not open `5432` or `8080`.

From the repository root on the EC2 host, run the Ubuntu bootstrap script:

```bash
bash infra/aws-demo/bootstrap-ubuntu.sh
```

It installs Docker + Compose plugin when needed, enables Docker, adds the login user to the `docker` group, and prepares the EBS-backed data root under `/mnt/querymind`.

## First Deploy

From the repository root on EC2, generate a deploy env:

```bash
OPENAI_API_KEY=<OPENAI_API_KEY> python scripts/qm.py aws-make-env --public-host <EC2_PUBLIC_DNS_OR_IP>
```

This writes `infra/aws-demo/.env.aws-demo` with generated secrets and consistent database URLs. If `OPENAI_API_KEY` is not set, the script prompts for it with hidden input.

Manual alternative:

```bash
cd infra/aws-demo
cp .env.aws-demo.example .env.aws-demo
```

Edit `.env.aws-demo` and replace at minimum:

- `PUBLIC_HOST`
- `JWT_SECRET`
- `DEFAULT_OWNER_API_KEY`
- `OPENAI_API_KEY`
- `POSTGRES_PASSWORD`
- both occurrences of the password inside `METADATA_DB_URL` and `DB_CONNECTIONS`

Keep `NUXT_PUBLIC_API_BASE=` empty for the default same-origin Nginx deployment. Set it only when the frontend is served from a different host than the API.

Run preflight checks before building:

```bash
python ../../scripts/aws_demo_preflight.py --env-file .env.aws-demo
```

Then deploy:

```bash
bash deploy.sh
```

The deploy script runs preflight, starts the Compose stack, and seeds metadata/demo data.

Manual equivalent:

```bash
docker compose --env-file .env.aws-demo -f docker-compose.aws-demo.yml up -d --build
docker compose --env-file .env.aws-demo -f docker-compose.aws-demo.yml ps
```

Initialize metadata and demo data after the containers are healthy:

```bash
docker compose --env-file .env.aws-demo -f docker-compose.aws-demo.yml exec api python infra/scripts/init_meta_db.py
docker compose --env-file .env.aws-demo -f docker-compose.aws-demo.yml exec api python infra/scripts/seed_metadata.py
docker compose --env-file .env.aws-demo -f docker-compose.aws-demo.yml exec api python seed_full_schema.py
```

Open:

```text
http://<EC2_PUBLIC_DNS_OR_IP>
```

Run a deployed smoke test from your machine or the EC2 host:

```bash
python ../../scripts/aws_demo_smoke_test.py --base-url http://<EC2_PUBLIC_DNS_OR_IP>
```

Add `--include-chat` only when you want to verify the configured LLM provider too.

Default seeded login after `seed_metadata.py`:

```text
owner@local / Owner123!
analyst@local / Analyst123!
viewer@local / Viewer123!
```

Change these passwords before showing a real demo.

## Operations

Health checks:

```bash
curl http://localhost/health
docker compose --env-file .env.aws-demo -f docker-compose.aws-demo.yml logs --tail=100 api
docker compose --env-file .env.aws-demo -f docker-compose.aws-demo.yml logs --tail=100 nginx
docker compose --env-file .env.aws-demo -f docker-compose.aws-demo.yml logs --tail=100 postgres
```

Backup before stopping or changing schema:

```bash
bash backup.sh
```

Restore from a backup directory:

```bash
bash restore.sh --backup-dir /mnt/querymind/backup/<timestamp> --yes
```

Demo shutdown:

```bash
docker compose --env-file .env.aws-demo -f docker-compose.aws-demo.yml down
```

Then stop the EC2 instance from AWS Console or CLI. Stopping Docker is not enough for the low-cost mode.

## Development From This Repo

For day-to-day development, use the Nuxt frontend in `frontend/` and the FastAPI backend locally. Keep `portal/` and `ui/` as secondary/legacy surfaces until there is a specific reason to deploy them.

The next repo hardening tasks before a public demo are:

1. Decide whether S3/Bedrock are in scope. If yes, uncomment and test `boto3` and `langchain-aws`.
2. Add HTTPS and set `REFRESH_COOKIE_SECURE=true` before using a real domain.
3. Replace seeded demo passwords before showing a real demo.
