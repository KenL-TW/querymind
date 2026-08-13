from __future__ import annotations

from sqlalchemy import create_engine, text

from config.settings import settings


def main() -> None:
    db_url = settings.db_connections_dict.get("default", "")
    if not db_url.startswith("postgresql"):
        raise ValueError("inspect_db.py requires a PostgreSQL DB_CONNECTIONS.default URL")

    engine = create_engine(db_url)
    with engine.connect() as conn:
        tables = [
            r[0]
            for r in conn.execute(text(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                ORDER BY table_name
                """
            )).fetchall()
        ]
        print("Tables:", tables)
        for t in tables:
            cnt = conn.execute(text(f"SELECT COUNT(*) FROM {t}"))  # noqa: S608
            cols = conn.execute(text(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = :table_name
                ORDER BY ordinal_position
                """
            ), {"table_name": t}).fetchall()
            print(f"  {t}: {cnt.scalar_one()} rows, cols={[c[0] for c in cols]}")


if __name__ == "__main__":
    main()
