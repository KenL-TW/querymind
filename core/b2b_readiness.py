from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import inspect as sa_inspect

from core.dlp import classify_column_name
from core.schema_observer import get_schema_observation_state


_DICT_DIR = Path("data/dictionary")


def build_connection_readiness(
    *,
    conn_name: str,
    alive: bool,
    access: dict[str, Any] | None,
    registry: Any,
    session_factory: Any,
) -> dict[str, Any]:
    """Build a B2B PoC onboarding/readiness snapshot for one connection."""
    schema_state = get_schema_observation_state(session_factory, conn_name)
    schema_inventory = _schema_inventory(conn_name, registry) if alive else {"tables": [], "columns": []}
    dictionary = _dictionary_coverage(conn_name, schema_inventory)
    sensitive_columns = _sensitive_columns(schema_inventory)

    checks: list[dict[str, Any]] = []
    checks.append(_check("connection_alive", "Connection test", "pass" if alive else "fail",
                         "Database ping is healthy." if alive else "Database ping failed or connection is inactive."))

    scanned = bool(schema_state.get("last_checked_at") or schema_state.get("fingerprint"))
    checks.append(_check("schema_scan", "Schema scan", "pass" if scanned else "warn",
                         f"{schema_state.get('table_count') or len(schema_inventory['tables'])} tables scanned."
                         if scanned else "Run schema scan before customer PoC."))

    drift_status = schema_state.get("status")
    drift_fail = drift_status == "changed"
    checks.append(_check("schema_drift", "Schema drift", "warn" if drift_fail else "pass",
                         "Schema drift detected; refresh schema context and regression set."
                         if drift_fail else "No active drift signal."))

    ratio = dictionary["ratio"]
    if ratio >= 0.7:
        dict_status = "pass"
    elif ratio >= 0.25:
        dict_status = "warn"
    else:
        dict_status = "fail" if schema_inventory["columns"] else "warn"
    checks.append(_check("dictionary_coverage", "Dictionary coverage", dict_status,
                         f"{dictionary['described_columns']}/{dictionary['total_columns']} columns described."))

    open_access = bool((access or {}).get("open_to_unrestricted_users"))
    checks.append(_check("access_policy", "RBAC assignment", "warn" if open_access else "pass",
                         "Some users can access this connection through unrestricted assignment."
                         if open_access else "Connection access is explicitly scoped or no unrestricted users found."))

    checks.append(_check("pii_review", "PII/DLP review", "warn" if sensitive_columns else "pass",
                         f"{len(sensitive_columns)} sensitive-looking columns need DLP review."
                         if sensitive_columns else "No sensitive-looking column names detected."))

    score = _score(checks, dictionary["ratio"])
    level = "ready" if score >= 80 and not any(c["status"] == "fail" for c in checks) else (
        "needs_attention" if score >= 50 else "not_ready"
    )
    return {
        "score": score,
        "level": level,
        "checks": checks,
        "dictionary_coverage": dictionary,
        "sensitive_columns": sensitive_columns[:50],
        "schema_state": schema_state,
    }


def _check(check_id: str, label: str, status: str, detail: str) -> dict[str, str]:
    return {"id": check_id, "label": label, "status": status, "detail": detail}


def _score(checks: list[dict[str, Any]], dictionary_ratio: float) -> int:
    score = 0
    weights = {
        "connection_alive": 25,
        "schema_scan": 20,
        "schema_drift": 15,
        "dictionary_coverage": 20,
        "access_policy": 10,
        "pii_review": 10,
    }
    for check in checks:
        weight = weights.get(check["id"], 0)
        if check["id"] == "dictionary_coverage":
            score += int(weight * max(0.0, min(1.0, dictionary_ratio)))
        elif check["status"] == "pass":
            score += weight
        elif check["status"] == "warn":
            score += int(weight * 0.45)
    return max(0, min(100, score))


def _schema_inventory(conn_name: str, registry: Any) -> dict[str, list[dict[str, Any]]]:
    try:
        connector = registry.get(conn_name)
        insp = sa_inspect(connector.engine)
        tables = sorted(insp.get_table_names())
    except Exception:
        return {"tables": [], "columns": []}

    columns: list[dict[str, Any]] = []
    for table in tables:
        try:
            raw_cols = insp.get_columns(table)
        except Exception:
            raw_cols = []
        for col in raw_cols:
            columns.append({
                "table": table,
                "column": str(col.get("name") or ""),
                "type": str(col.get("type") or ""),
            })
    return {"tables": [{"name": t} for t in tables], "columns": columns}


def _dictionary_coverage(conn_name: str, schema_inventory: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    total_columns = len(schema_inventory.get("columns") or [])
    stored = _load_dictionary(conn_name)
    table_meta = stored.get("tables", {}) if isinstance(stored, dict) else {}
    described = 0
    for item in schema_inventory.get("columns") or []:
        table = item.get("table")
        column = item.get("column")
        desc = ((table_meta.get(table, {}) or {}).get("columns", {}) or {}).get(column, "")
        if str(desc).strip():
            described += 1
    ratio = (float(described) / float(total_columns)) if total_columns else 0.0
    return {
        "described_columns": described,
        "total_columns": total_columns,
        "ratio": round(ratio, 4),
    }


def _load_dictionary(conn_name: str) -> dict[str, Any]:
    path = _DICT_DIR / f"{conn_name}.json"
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"tables": {}}
    return {"tables": {}}


def _sensitive_columns(schema_inventory: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in schema_inventory.get("columns") or []:
        hits = classify_column_name(str(item.get("column") or ""))
        if hits:
            out.append({
                "table": item.get("table"),
                "column": item.get("column"),
                "patterns": hits,
            })
    return out
