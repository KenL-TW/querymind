# QueryMind Start Here

Use this file as the first decision point for development and AWS deployment.

## Recommended Path

1. Start local development with Docker PostgreSQL and native backend/frontend.
2. Validate the repo with preflight checks.
3. Deploy the AWS demo stack to one EC2 instance.
4. Run the deployed smoke test.
5. Only then decide whether to add RDS, ALB, ECS, S3, Bedrock, HTTPS, or a domain.

The current AWS target is a low-cost demo, not a production SaaS architecture.

## Local Development

Use this for daily development:

```bash
python scripts/qm.py dev-db-up
cp .env.local.example .env.local
```

Set `OPENAI_API_KEY` in `.env.local`, then install and initialize:

```bash
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python infra/scripts/init_meta_db.py
.venv\Scripts\python infra/scripts/seed_metadata.py
.venv\Scripts\python seed_full_schema.py
```

Start backend:

```bash
.venv\Scripts\python main.py
```

Start frontend:

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
Nuxt: http://localhost:3000
FastAPI: http://localhost:8101
Swagger: http://localhost:8101/docs
```

Full details: `infra/dev/README.md`.

## AWS Demo Deployment

Use this for the first AWS demo:

- One EC2 instance.
- One EBS-backed data root mounted at `/mnt/querymind`.
- Docker Compose.
- Nginx on public port `80`.
- FastAPI on the internal Docker network.
- Nuxt generated static assets.
- PostgreSQL container with persistent EBS storage.

Prepare the EC2 host from the repository root:

```bash
bash infra/aws-demo/bootstrap-ubuntu.sh
```

Create AWS demo env:

```bash
OPENAI_API_KEY=<OPENAI_API_KEY> python scripts/qm.py aws-make-env --public-host <EC2_PUBLIC_DNS_OR_IP>
```

This generates `infra/aws-demo/.env.aws-demo` with consistent secrets and database URLs.

If you create the env manually, replace at least:

```text
PUBLIC_HOST
JWT_SECRET
DEFAULT_OWNER_API_KEY
OPENAI_API_KEY
POSTGRES_PASSWORD
passwords inside METADATA_DB_URL and DB_CONNECTIONS
```

Run preflight:

```bash
python ../../scripts/aws_demo_preflight.py --env-file .env.aws-demo
```

Deploy:

```bash
bash deploy.sh
```

The deploy script runs preflight, starts Compose, and initializes data. To run the smoke test as part of deploy:

```bash
bash deploy.sh --smoke-base-url http://<EC2_PUBLIC_DNS_OR_IP>
```

Verify deployment:

```bash
python ../../scripts/aws_demo_smoke_test.py --base-url http://<EC2_PUBLIC_DNS_OR_IP>
```

Back up before demo data changes or upgrades:

```bash
python scripts/qm.py aws-backup
```

Full details: `infra/aws-demo/README.md`.

## Validation Commands

Run from the repository root:

```bash
python scripts/qm.py aws-preflight --env-file infra/aws-demo/.env.aws-demo
python scripts/qm.py check
```

If your local environment cannot access Docker config, you can still run the non-Docker preflight subset:

```bash
python scripts/qm.py aws-preflight --env-file infra/aws-demo/.env.aws-demo.example --allow-placeholders --skip-compose --skip-build-checks
```

GitHub Actions runs the same core gates in `.github/workflows/ci.yml`: placeholder preflight, Docker Compose config, Python compileall, and frontend typecheck.

## What Not To Deploy First

Keep these out of the first demo unless the requirement changes:

- RDS
- ALB
- ECS
- NAT Gateway
- Route 53
- CloudFront
- S3 storage backend
- Bedrock provider
- EventBridge scheduler

Those are useful later, but they increase cost and operational surface before the basic product loop is proven.

## Next Production Hardening

Before a public or long-running deployment:

1. Add HTTPS and set `REFRESH_COOKIE_SECURE=true`.
2. Replace seeded demo passwords.
3. Move secrets out of `.env` into a managed secret store.
4. Add automated backup restore testing.
5. Decide whether the app needs RDS/S3/Bedrock/EventBridge based on actual demo usage.
