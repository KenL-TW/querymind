from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, dataclass, field
from difflib import get_close_matches
from typing import Any

from core.intent import detect_intent
from core.query_planner import build_query_plan_payload
from core.schema_resolver import resolve_schema_context
from core.validator import validate_sql_result
from db.registry import ConnectionRegistry
from sqlalchemy import inspect as sa_inspect


@dataclass
class FlowStep:
    name: str
    status: str = "success"
    input: dict[str, Any] = field(default_factory=dict)
    output: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    latency_ms: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def build_agent_flow_trace(
    question: str,
    registry: ConnectionRegistry,
    conn_name: str = "default",
    *,
    run_validation: bool = True,
) -> dict[str, Any]:
    """Build a deterministic trace for the DB-agent planning pipeline.

    The trace is intentionally product-safe: it contains structured summaries,
    not hidden chain-of-thought. It can be surfaced in the UI/debug panel and
    logged for analysis.
    """
    started = time.monotonic()
    steps: list[FlowStep] = []

    intent = _timed_step(
        steps,
        "intent_router",
        {"question": question},
        lambda: detect_intent(question).to_dict(),
    )
    schema_context = _timed_step(
        steps,
        "schema_resolver",
        {"conn_name": conn_name, "question": question},
        lambda: resolve_schema_context(question, registry, conn_name),
    )
    query_plan = _timed_step(
        steps,
        "query_plan",
        {"question": question},
        lambda: build_query_plan_payload(question) or {},
    )

    validation: dict[str, Any] = {}
    sql = str((query_plan or {}).get("sql") or "")
    if sql and run_validation:
        validation = _timed_step(
            steps,
            "sql_validator",
            {"conn_name": conn_name, "sql": sql},
            lambda: validate_sql_with_repair(registry, conn_name, sql),
        )

    return {
        "conn_name": conn_name,
        "intent": intent or {},
        "schema_context": schema_context or {},
        "query_plan": query_plan or {},
        "sql_validation": validation or {},
        "steps": [s.to_dict() for s in steps],
        "latency_ms": int((time.monotonic() - started) * 1000),
    }


def validate_sql_dry_run(registry: ConnectionRegistry, conn_name: str, sql: str) -> dict[str, Any]:
    """Validate SQL with EXPLAIN, without executing the full query."""
    connector = registry.get(conn_name)
    cleaned = (sql or "").strip().rstrip(";")
    if not cleaned:
        return {"ok": False, "error": "empty SQL", "warnings": ["SQL 為空。"]}
    try:
        rows = connector.execute(f"EXPLAIN (ANALYZE false, VERBOSE false, FORMAT JSON) {cleaned}")
        return {
            "ok": True,
            "warnings": _semantic_sql_warnings(cleaned),
            "plan_summary": _summarize_explain(rows),
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc)[:1000],
            "warnings": [f"SQL dry-run 失敗：{str(exc)[:240]}"],
        }


def validate_sql_with_repair(
    registry: ConnectionRegistry,
    conn_name: str,
    sql: str,
    *,
    max_attempts: int = 2,
) -> dict[str, Any]:
    """Validate SQL and apply conservative deterministic repairs."""
    attempts: list[dict[str, Any]] = []
    original = sql or ""
    current_sql = original
    for _attempt in range(max(1, max_attempts) + 1):
        validation = validate_sql_dry_run(registry, conn_name, current_sql)
        attempts.append({"sql": current_sql, "validation": validation})
        if validation.get("ok"):
            return {
                "ok": True,
                "sql": current_sql,
                "validation": validation,
                "repaired": current_sql.strip() != original.strip(),
                "attempts": attempts,
            }
        repaired = repair_sql_once(current_sql, validation, registry=registry, conn_name=conn_name)
        if repaired.strip() == current_sql.strip():
            break
        current_sql = repaired

    return {
        "ok": False,
        "sql": current_sql,
        "validation": attempts[-1]["validation"] if attempts else {},
        "repaired": current_sql.strip() != original.strip(),
        "attempts": attempts,
    }


def repair_sql_once(
    sql: str,
    validation: dict[str, Any] | None = None,
    *,
    registry: ConnectionRegistry | None = None,
    conn_name: str = "default",
) -> str:
    """One deterministic repair pass for known semantic/schema mistakes."""
    repaired = sql or ""
    validation_text = json.dumps(validation or {}, ensure_ascii=False).lower()
    lowered = repaired.lower()

    if "oi.price" in lowered or "order_items.price" in lowered or "price" in validation_text:
        replacements = [
            (r"\bSUM\s*\(\s*oi\.price\s*\*\s*oi\.quantity\s*\)", "SUM(oi.subtotal)"),
            (
                r"\bSUM\s*\(\s*order_items\.price\s*\*\s*order_items\.quantity\s*\)",
                "SUM(order_items.subtotal)",
            ),
            (r"\boi\.price\s*\*\s*oi\.quantity\b", "oi.subtotal"),
            (r"\border_items\.price\s*\*\s*order_items\.quantity\b", "order_items.subtotal"),
            (r"\boi\.price\b", "oi.unit_price"),
            (r"\border_items\.price\b", "order_items.unit_price"),
        ]
        for pattern, replacement in replacements:
            repaired = re.sub(pattern, replacement, repaired, flags=re.IGNORECASE)

    replacements = [
        (r"\bSUM\s*\(\s*p\.price\s*\*\s*oi\.quantity\s*\)", "SUM(oi.subtotal)"),
        (
            r"\bSUM\s*\(\s*products\.price\s*\*\s*order_items\.quantity\s*\)",
            "SUM(order_items.subtotal)",
        ),
    ]
    for pattern, replacement in replacements:
        repaired = re.sub(pattern, replacement, repaired, flags=re.IGNORECASE)

    if registry is not None:
        repaired = _repair_missing_common_joins(repaired, validation)
        repaired = _repair_schema_columns(repaired, validation, registry, conn_name)

    return repaired


def _repair_schema_columns(
    sql: str,
    validation: dict[str, Any] | None,
    registry: ConnectionRegistry,
    conn_name: str,
) -> str:
    validation_text = json.dumps(validation or {}, ensure_ascii=False)
    lowered = validation_text.lower()
    if not any(term in lowered for term in ("undefinedcolumn", "does not exist", "ambiguous", "不存在", "模糊")):
        return sql

    try:
        inspector = sa_inspect(registry.get(conn_name).engine)
    except Exception:
        return sql

    aliases = _extract_table_aliases(sql)
    if not aliases:
        return sql

    repaired = sql
    unknown_match = re.search(r'column\s+"?([A-Za-z_][\w]*)(?:\.([A-Za-z_][\w]*))?"?\s+does not exist', validation_text, re.I)
    if unknown_match:
        first = unknown_match.group(1)
        second = unknown_match.group(2)
        if second:
            alias, column = first, second
            replacement = _best_column_for_alias(inspector, aliases, alias, column)
            if replacement:
                repaired = re.sub(rf"\b{re.escape(alias)}\.{re.escape(column)}\b", f"{alias}.{replacement}", repaired)
        else:
            column = first
            replacement = _best_qualified_column(inspector, aliases, column)
            if replacement:
                repaired = re.sub(rf"(?<!\.)\b{re.escape(column)}\b", replacement, repaired)

    ambiguous_match = re.search(r'column reference\s+"?([A-Za-z_][\w]*)"?\s+is ambiguous', validation_text, re.I)
    if ambiguous_match:
        column = ambiguous_match.group(1)
        replacement = _preferred_qualified_column(inspector, aliases, column)
        if replacement:
            repaired = re.sub(rf"(?<!\.)\b{re.escape(column)}\b", replacement, repaired)

    return repaired


def _repair_missing_common_joins(sql: str, validation: dict[str, Any] | None) -> str:
    validation_text = json.dumps(validation or {}, ensure_ascii=False).lower()
    repaired = sql
    aliases = _extract_table_aliases(repaired)
    missing_aliases = set(re.findall(r'missing from-clause entry for table "?([a-z_][\w]*)"?', validation_text, re.I))
    referenced_aliases = {m.group(1).lower() for m in re.finditer(r"\b([A-Za-z_]\w*)\.", repaired)}
    needed = missing_aliases | (referenced_aliases - {a.lower() for a in aliases})

    if "oi" in aliases and "p" in needed and "p" not in aliases:
        repaired = _insert_join_before_clauses(repaired, " JOIN products p ON oi.product_id = p.id")
        aliases["p"] = "products"
    if "o" in aliases and "oi" in needed and "oi" not in aliases:
        repaired = _insert_join_before_clauses(repaired, " JOIN order_items oi ON oi.order_id = o.id")
        aliases["oi"] = "order_items"
    if "p" in aliases and "oi" in needed and "oi" not in aliases:
        repaired = _insert_join_before_clauses(repaired, " JOIN order_items oi ON oi.product_id = p.id")
        aliases["oi"] = "order_items"
    if "p" in aliases and "c" in needed and "c" not in aliases:
        repaired = _insert_join_before_clauses(repaired, " JOIN categories c ON p.category_id = c.id")
        aliases["c"] = "categories"
    if "oi" in aliases and "o" in needed and "o" not in aliases:
        repaired = _insert_join_before_clauses(repaired, " JOIN orders o ON oi.order_id = o.id")
        aliases["o"] = "orders"
    if "oi" in aliases and "cu" in needed and "o" not in aliases:
        repaired = _insert_join_before_clauses(repaired, " JOIN orders o ON oi.order_id = o.id")
        aliases["o"] = "orders"
    if "o" in aliases and "cu" in needed and "cu" not in aliases:
        repaired = _insert_join_before_clauses(repaired, " JOIN customers cu ON o.customer_id = cu.id")

    return repaired


def _extract_table_aliases(sql: str) -> dict[str, str]:
    aliases: dict[str, str] = {}
    pattern = re.compile(
        r"\b(?:FROM|JOIN)\s+([A-Za-z_][\w.]*)(?:\s+(?:AS\s+)?([A-Za-z_][\w]*))?",
        re.I,
    )
    reserved = {"on", "where", "group", "order", "having", "limit", "inner", "left", "right", "full", "cross", "join"}
    for match in pattern.finditer(sql or ""):
        table = match.group(1).split(".")[-1].strip('"')
        alias = (match.group(2) or table).strip('"')
        if alias.lower() in reserved:
            alias = table
        aliases[alias] = table
    return aliases


def _insert_join_before_clauses(sql: str, join_sql: str) -> str:
    match = re.search(r"\b(WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT)\b", sql, re.I)
    if not match:
        return f"{sql.rstrip()} {join_sql.strip()}"
    return f"{sql[:match.start()].rstrip()} {join_sql.strip()} {sql[match.start():].lstrip()}"


def _best_column_for_alias(inspector, aliases: dict[str, str], alias: str, column: str) -> str | None:
    table = aliases.get(alias)
    if not table:
        return None
    columns = _table_columns(inspector, table)
    if column in columns:
        return column
    synonym = _column_synonym(column, table)
    if synonym in columns:
        return synonym
    matches = get_close_matches(column, columns, n=1, cutoff=0.72)
    return matches[0] if matches else None


def _best_qualified_column(inspector, aliases: dict[str, str], column: str) -> str | None:
    candidates: list[tuple[str, str]] = []
    for alias, table in aliases.items():
        columns = _table_columns(inspector, table)
        synonym = _column_synonym(column, table)
        if column in columns:
            candidates.append((alias, column))
        elif synonym in columns:
            candidates.append((alias, synonym))
        else:
            matches = get_close_matches(column, columns, n=1, cutoff=0.78)
            if matches:
                candidates.append((alias, matches[0]))
    if len(candidates) == 1:
        alias, col = candidates[0]
        return f"{alias}.{col}"
    return _preferred_qualified_column(inspector, aliases, column)


def _preferred_qualified_column(inspector, aliases: dict[str, str], column: str) -> str | None:
    if column == "id":
        return None
    preferences = {
        "name": ("p", "products", "c", "categories", "cu", "customers"),
        "ordered_at": ("o", "orders"),
        "created_at": ("o", "orders"),
        "status": ("o", "orders"),
        "subtotal": ("oi", "order_items"),
        "quantity": ("oi", "order_items"),
    }
    preferred = preferences.get(column, ())
    for key in preferred:
        for alias, table in aliases.items():
            if key in {alias, table} and column in _table_columns(inspector, table):
                return f"{alias}.{column}"
            synonym = _column_synonym(column, table)
            if key in {alias, table} and synonym in _table_columns(inspector, table):
                return f"{alias}.{synonym}"

    exact = [(alias, table) for alias, table in aliases.items() if column in _table_columns(inspector, table)]
    if len(exact) == 1:
        return f"{exact[0][0]}.{column}"
    return None


def _table_columns(inspector, table: str) -> list[str]:
    try:
        return [str(col.get("name", "")) for col in inspector.get_columns(table)]
    except Exception:
        return []


def _column_synonym(column: str, table: str) -> str:
    column_lc = (column or "").lower()
    table_lc = (table or "").lower()
    if table_lc == "order_items" and column_lc in {"price", "amount", "sales", "revenue", "sales_amount", "total_sales"}:
        return "subtotal"
    if table_lc == "orders" and column_lc in {"date", "order_date", "created_at", "time", "order_time"}:
        return "ordered_at"
    if table_lc == "products" and column_lc in {"product", "product_name", "title"}:
        return "name"
    if table_lc == "categories" and column_lc in {"category", "category_name"}:
        return "name"
    if table_lc == "customers" and column_lc in {"customer", "customer_name"}:
        return "name"
    return column


def diagnose_empty_result(
    registry: ConnectionRegistry,
    conn_name: str,
    sql: str,
    rows: list[dict],
) -> dict[str, Any]:
    """Explain likely reasons for an empty result set."""
    if rows:
        return {"empty": False, "warnings": validate_sql_result(rows, sql)}

    connector = registry.get(conn_name)
    diagnostics: list[str] = []
    metadata: dict[str, Any] = {}
    lowered = (sql or "").lower()

    if "ordered_at" in lowered and "orders" in lowered:
        try:
            bounds = connector.execute("SELECT MIN(ordered_at) AS min_ts, MAX(ordered_at) AS max_ts, COUNT(*) AS rows_with_value FROM orders WHERE ordered_at IS NOT NULL")
            if bounds:
                metadata["orders_time_range"] = bounds[0]
                max_ts = bounds[0].get("max_ts")
                diagnostics.append(
                    f"orders.ordered_at 的最新時間是 {max_ts}；若問題使用「近 N 天」且以 NOW() 回推，可能超出資料實際涵蓋範圍。"
                )
        except Exception:
            pass

    if " join " in lowered:
        diagnostics.append("查詢包含 JOIN；若資料為 0，請檢查 join key 是否存在對應資料，或改用 LEFT JOIN 驗證。")
    if " where " in lowered:
        diagnostics.append("查詢包含 WHERE 條件；可逐步移除時間或狀態條件確認是哪個條件造成 0 筆。")
    if "status <> 'cancelled'" in lowered or 'status !=' in lowered:
        diagnostics.append("狀態條件可能排除資料；可先檢查 orders.status 的 distinct values。")

    return {
        "empty": True,
        "warnings": validate_sql_result(rows, sql),
        "diagnostics": diagnostics,
        "metadata": metadata,
    }


def trace_to_debug_steps(trace: dict[str, Any]) -> list[dict[str, str]]:
    """Convert trace into ThoughtStep-compatible items for API responses."""
    out: list[dict[str, str]] = []
    for step in trace.get("steps", []):
        name = str(step.get("name", ""))
        status = str(step.get("status", ""))
        output = step.get("output", {})
        error = step.get("error")
        out.append({
            "thought": "",
            "action": name,
            "action_input": json.dumps(step.get("input", {}), ensure_ascii=False)[:1000],
            "observation": json.dumps({
                "status": status,
                "output": output,
                "error": error,
                "latency_ms": step.get("latency_ms", 0),
            }, ensure_ascii=False, default=str)[:2000],
        })
    return out


def _timed_step(steps: list[FlowStep], name: str, input_payload: dict[str, Any], fn):
    t0 = time.monotonic()
    step = FlowStep(name=name, input=input_payload)
    try:
        output = fn()
        step.output = output if isinstance(output, dict) else {"value": output}
        return output
    except Exception as exc:  # noqa: BLE001
        step.status = "error"
        step.error = str(exc)[:1000]
        return {}
    finally:
        step.latency_ms = int((time.monotonic() - t0) * 1000)
        steps.append(step)


def _semantic_sql_warnings(sql: str) -> list[str]:
    warnings: list[str] = []
    lowered = sql.lower()
    if "oi.price" in lowered or "order_items.price" in lowered:
        warnings.append("order_items 沒有 price 欄位；銷售額請使用 order_items.subtotal。")
    if "sum(p.price" in lowered:
        warnings.append("products.price 是目前標價，不是歷史成交金額；銷售額請使用 order_items.subtotal。")
    if "sum(oi.subtotal)" in lowered and "ordered_at" not in lowered:
        warnings.append("銷售額查詢建議使用 orders.ordered_at 做時間過濾。")
    return warnings


def _summarize_explain(rows: list[dict]) -> dict[str, Any]:
    try:
        plan = rows[0].get("QUERY PLAN") if rows else None
        if isinstance(plan, list) and plan:
            root = plan[0].get("Plan", {})
            return {
                "node_type": root.get("Node Type"),
                "startup_cost": root.get("Startup Cost"),
                "total_cost": root.get("Total Cost"),
                "plan_rows": root.get("Plan Rows"),
                "plan_width": root.get("Plan Width"),
            }
    except Exception:
        pass
    return {"raw_rows": len(rows or [])}
