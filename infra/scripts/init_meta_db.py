"""
One-time script: initialise the QueryMind metadata PostgreSQL database.
Run: python infra/scripts/init_meta_db.py
"""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure project root is in sys.path when run directly
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from config.settings import settings
from storage.metadata_db import init_metadata_db

if __name__ == "__main__":
    print(f"Initialising metadata DB: {settings.metadata_db_url}")
    init_metadata_db(settings.metadata_db_url)
    print("Done — tables created (if not already present).")
