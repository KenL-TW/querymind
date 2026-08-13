"""TTL-based in-process cache for SQL SELECT query results.

Keyed by SHA-256 of ``conn_name + normalised SQL``.
Only SELECT / WITH / EXPLAIN queries are eligible for caching.
Write operations always bypass the cache.

Suitable for single-process deployments.  For multi-worker or Lambda
deployments this module can be replaced by a Redis-backed implementation
that exposes the same ``get`` / ``put`` / ``invalidate`` / ``stats`` API.

Cache is never consulted when the calling role has DLP masking enabled —
masking is applied *after* a cache hit so raw (unmasked) rows are stored.
The DLP layer in ``tools/db_tools.execute_query`` always runs on the result
regardless of whether rows came from cache or the live DB.
"""

from __future__ import annotations

import hashlib
import logging
import re
import time
from threading import Lock

logger = logging.getLogger(__name__)

_CACHEABLE_VERBS: frozenset[str] = frozenset({"SELECT", "WITH", "EXPLAIN"})

# Internal store: key → (expires_at_monotonic, rows)
_cache: dict[str, tuple[float, list[dict]]] = {}
_cache_lock = Lock()


# ── Helpers ──────────────────────────────────────────────────────────────────


def _normalize(sql: str) -> str:
    """Lowercase + collapse whitespace for a stable cache key."""
    return re.sub(r"\s+", " ", sql.strip().lower())


def _make_key(conn_name: str, sql: str) -> str:
    payload = f"{conn_name}:{_normalize(sql)}"
    return hashlib.sha256(payload.encode()).hexdigest()[:24]


def is_cacheable(sql: str) -> bool:
    """Return True only for pure read queries (SELECT / WITH / EXPLAIN)."""
    verb = (sql or "").strip().split()[0].upper() if (sql or "").strip() else ""
    return verb in _CACHEABLE_VERBS


# ── Public API ────────────────────────────────────────────────────────────────


def get(conn_name: str, sql: str, ttl_seconds: float) -> list[dict] | None:
    """Return cached rows or *None* on miss / expiry.

    A miss is silently ignored — the caller should fall through to the DB.
    """
    if not is_cacheable(sql):
        return None
    key = _make_key(conn_name, sql)
    with _cache_lock:
        entry = _cache.get(key)
        if entry is None:
            return None
        expires_at, rows = entry
        if time.monotonic() > expires_at:
            _cache.pop(key, None)
            return None
    logger.debug("query_cache HIT key=%.8s rows=%d", key, len(rows))
    return rows


def put(conn_name: str, sql: str, rows: list[dict], ttl_seconds: float) -> None:
    """Store *rows* in cache.  No-op for non-cacheable queries."""
    if not is_cacheable(sql):
        return
    if ttl_seconds <= 0:
        return
    key = _make_key(conn_name, sql)
    with _cache_lock:
        _cache[key] = (time.monotonic() + ttl_seconds, rows)
    logger.debug("query_cache SET key=%.8s rows=%d ttl=%.0fs", key, len(rows), ttl_seconds)


def invalidate(conn_name: str | None = None) -> int:
    """Evict all cache entries and return the count cleared.

    Because keys are hashed we cannot cheaply filter by connection name, so
    any ``conn_name``-scoped invalidation clears the entire cache — acceptable
    given typical cache sizes.
    """
    with _cache_lock:
        count = len(_cache)
        _cache.clear()
    logger.info("query_cache invalidated %d entries (scope=%s)", count, conn_name or "*")
    return count


def stats() -> dict:
    """Return a lightweight stats snapshot (no lock held while building)."""
    with _cache_lock:
        total = len(_cache)
        now = time.monotonic()
        active = sum(1 for exp, _ in _cache.values() if exp > now)
    return {"total_entries": total, "active_entries": active, "expired_entries": total - active}
