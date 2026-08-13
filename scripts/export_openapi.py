"""Dump the FastAPI OpenAPI schema to disk.

\u7528\u9014\uff1a\u7d66\u524d\u7aef\uff08frontend/\uff09\u4ee5 openapi-typescript \u7522\u5b78\u5165\u5b8c\u5168\u578b\u5225\u7684 API client\u3002

Usage (PowerShell):
    cd "c:\\Users\\User\\Desktop\\db agent\\querymind"
    .\\.venv\\Scripts\\python.exe scripts/export_openapi.py
    # \u8f38\u51fa\u5728 frontend/openapi.json
"""
from __future__ import annotations

import json
from pathlib import Path


def main() -> Path:
    # Lazy-import so the script can run without booting full app deps when only
    # the schema is required.
    from api.main import app

    out_dir = Path("frontend")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "openapi.json"

    schema = app.openapi()
    out_path.write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: wrote {out_path} ({out_path.stat().st_size:,} bytes, "
          f"{len(schema.get('paths', {}))} paths)")
    return out_path


if __name__ == "__main__":
    main()
