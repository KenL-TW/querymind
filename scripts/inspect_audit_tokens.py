from __future__ import annotations

from sqlalchemy import create_engine, text

from config.settings import settings


def main() -> None:
    db_url = settings.metadata_db_url
    if not db_url.startswith("postgresql"):
        raise ValueError("inspect_audit_tokens.py requires a PostgreSQL METADATA_DB_URL")

    engine = create_engine(db_url)
    with engine.connect() as conn:
        print("--- tables ---")
        for r in conn.execute(text(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
            """
        )):
            print(" ", r[0])

        print()
        print("--- counts ---")
        for t in ("qm_audit_log", "qm_refresh_tokens", "qm_api_keys", "qm_users", "qm_invitations"):
            try:
                c = conn.execute(text(f"SELECT COUNT(*) FROM {t}"))  # noqa: S608
                print(f"  {t}: {c.scalar_one()}")
            except Exception as e:
                print(f"  {t}: ERR {e}")

        print()
        print("--- audit event_type distribution ---")
        for r in conn.execute(text(
            """
            SELECT event_type, status, COUNT(*)
            FROM qm_audit_log
            GROUP BY event_type, status
            ORDER BY 3 DESC
            """
        )):
            print(" ", r)

        print()
        print("--- last 8 audit ---")
        for r in conn.execute(text(
            """
            SELECT id, created_at, event_type, tool_name, status, duration_ms, api_key_prefix, session_id
            FROM qm_audit_log
            ORDER BY id DESC
            LIMIT 8
            """
        )):
            print(" ", r)

        print()
        print("--- refresh tokens (latest 8) ---")
        for r in conn.execute(text(
            """
            SELECT id, user_id, substr(token_hash,1,12), expires_at, revoked, created_at
            FROM qm_refresh_tokens
            ORDER BY id DESC
            LIMIT 8
            """
        )):
            print(" ", r)


if __name__ == "__main__":
    main()
