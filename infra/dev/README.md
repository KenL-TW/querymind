# QueryMind Local Development

This path keeps day-to-day development native on your machine:

- PostgreSQL runs in Docker.
- FastAPI runs from the repository with Python.
- Nuxt runs from `frontend/` with Node.

It mirrors the AWS demo databases (`querymind` and `querymind_meta`) without building the full production-like Docker stack.

## 1. Start PostgreSQL

From the repository root:

```bash
python scripts/qm.py dev-db-up
```

The database is exposed at `127.0.0.1:5432` with:

```text
user: qm_user
password: qm_pass
app database: querymind
metadata database: querymind_meta
```

## 2. Create Local Env

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and set `OPENAI_API_KEY`. The default database URLs already match the dev PostgreSQL container.

## 3. Install Dependencies

```bash
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt

cd frontend
npm install
```

Use the equivalent `source .venv/bin/activate` commands on Linux/macOS.

## 4. Initialize Data

From the repository root:

```bash
.venv\Scripts\python infra/scripts/init_meta_db.py
.venv\Scripts\python infra/scripts/seed_metadata.py
.venv\Scripts\python seed_full_schema.py
```

Default seeded users:

```text
owner@local / Owner123!
analyst@local / Analyst123!
viewer@local / Viewer123!
```

## 5. Run The App

Backend:

```bash
.venv\Scripts\python main.py
```

Frontend:

```bash
cd frontend
npm run dev
```

Open:

```text
Nuxt: http://localhost:3000
FastAPI: http://localhost:8101
Swagger: http://localhost:8101/docs
```

If you change `API_PORT`, also set `NUXT_PUBLIC_API_BASE` in `frontend/.env` or your shell.
