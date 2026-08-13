"""QueryMind PostgreSQL full-demo seeder orchestrator.

This script intentionally keeps a PostgreSQL-only workflow and delegates
to the maintained seeders:
- seed_demo.py for business demo tables
- infra/scripts/seed_metadata.py for auth/session/audit metadata

Usage:
  python seed_full_demo.py
  python seed_full_demo.py --app-db-url postgresql+psycopg2://qm_user:qm_pass@127.0.0.1:5432/querymind --meta-db-url postgresql+psycopg2://qm_user:qm_pass@127.0.0.1:5432/querymind_meta
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from config.settings import settings


def _run(cmd: list[str]) -> None:
    completed = subprocess.run(cmd, check=False, cwd=Path(__file__).resolve().parent)
    if completed.returncode != 0:
        raise RuntimeError(f"Command failed ({completed.returncode}): {' '.join(cmd)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed QueryMind full demo data in PostgreSQL.")
    parser.add_argument(
        "--app-db-url",
        default=settings.db_connections_dict.get("default", ""),
        help="PostgreSQL URL for application data",
    )
    parser.add_argument(
        "--meta-db-url",
        default=settings.metadata_db_url,
        help="PostgreSQL URL for metadata data",
    )
    args = parser.parse_args()

    if not args.app_db_url.startswith("postgresql"):
        raise ValueError("--app-db-url must be a PostgreSQL connection URL")
    if not args.meta_db_url.startswith("postgresql"):
        raise ValueError("--meta-db-url must be a PostgreSQL connection URL")

    py = sys.executable
    _run([py, "seed_demo.py", "--db-url", args.app_db_url])
    _run([py, "infra/scripts/init_meta_db.py"])
    _run([py, "infra/scripts/seed_metadata.py", "--db-url", args.meta_db_url])

    print("PostgreSQL full demo seed completed.")


if __name__ == "__main__":
    main()
