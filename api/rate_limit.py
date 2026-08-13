from __future__ import annotations

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def _rate_limit_key(request: Request) -> str:
    """
    Identify the caller for rate limiting.

    Priority:
      1. API key (masked) — ensures per-key limit even behind a shared proxy
      2. Client IP — fallback for unauthenticated / health endpoints
    """
    api_key = request.headers.get("X-API-Key", "")
    if api_key:
        # Use first 16 chars so the key is never logged in full
        return f"key:{api_key[:16]}"
    host = request.client.host if request.client else "unknown"
    return f"ip:{host}"


# Module-level singleton — imported by api/main.py and route modules
limiter = Limiter(key_func=_rate_limit_key)
