"""
Analysis tools — fine-grained data exploration helpers used by the agent.

These complement `db_tools.execute_query` by exposing structured, single-purpose
operations that a senior data analyst/engineer would reach for first, so the
agent can plan analyses without writing ad-hoc SQL for every probe.

All tools are RBAC-aware (read-only intent) and reuse the same connection registry.
"""
from __future__ import annotations

import json
import logging
from typing import Annotated, Any

from langchain_core.tools import tool
from sqlalchemy import inspect as sa_inspect, text

from api.context import get_current_user
from core.rbac import PermissionDeniedError, assert_conn_allowed, assert_tool_allowed
from db.connector import DBConnector
from db.registry import ConnectionRegistry

logger = logging.getLogger(__name__)


def _deny(error: Exception) -> str:
    return json.dumps({"error": str(error), "denied": True}, ensure_ascii=False)


def _safe_ident(name: str) -> str:
    """Quote an identifier defensively (allow only [\\w]+)."""
    if not name or not name.replace("_", "").isalnum():
        raise ValueError(f"非法識別字: {name!r}")
    return f'"{name}"'


def make_analysis_tools(registry: ConnectionRegistry):
    """Return analysis tools bound to the given registry."""

    def _conn(conn_name: str) -> DBConnector:
        return registry.get(conn_name)

    def _check(conn_name: str, tool_name: str) -> None:
        user = get_current_user()
        assert_tool_allowed(user, tool_name)
        assert_conn_allowed(user, conn_name)

    # ── 1. profile_table ─────────────────────────────────────────────────────
    @tool
    def profile_table(
        table_name: Annotated[str, "Table name to profile"],
        conn_name: Annotated[str, "Connection name"] = "default",
    ) -> str:
        """
        Return a one-shot data-profile for a table:
        row count, column count, per-column type, NULL ratio, distinct count.

        Use this BEFORE writing any aggregate SQL to know what's in a table.
        """
        try:
            _check(conn_name, "profile_table")
        except PermissionDeniedError as e:
            return _deny(e)

        conn = _conn(conn_name)
        try:
            insp = sa_inspect(conn.engine)
            cols = insp.get_columns(table_name)
        except Exception as exc:
            return json.dumps({"error": f"無法檢視 {table_name}: {exc}"}, ensure_ascii=False)

        tbl = _safe_ident(table_name)
        total = conn.execute(f"SELECT COUNT(*) AS n FROM {tbl}")[0]["n"]

        col_profiles: list[dict] = []
        for c in cols:
            col_name = c["name"]
            col_q = _safe_ident(col_name)
            try:
                row = conn.execute(f"""
                    SELECT
                      SUM(CASE WHEN {col_q} IS NULL THEN 1 ELSE 0 END) AS nulls,
                      COUNT(DISTINCT {col_q}) AS distincts
                    FROM {tbl}
                """)[0]
                nulls = int(row.get("nulls") or 0)
                distincts = int(row.get("distincts") or 0)
            except Exception:
                nulls, distincts = -1, -1
            col_profiles.append({
                "name": col_name,
                "type": str(c["type"]),
                "nullable": c.get("nullable", True),
                "null_count": nulls,
                "null_ratio": round(nulls / total, 4) if total and nulls >= 0 else None,
                "distinct_count": distincts,
                "cardinality_ratio": round(distincts / total, 4) if total and distincts >= 0 else None,
            })

        return json.dumps({
            "table": table_name,
            "row_count": int(total),
            "column_count": len(cols),
            "columns": col_profiles,
        }, ensure_ascii=False, default=str)

    # ── 2. column_stats ──────────────────────────────────────────────────────
    @tool
    def column_stats(
        table_name: Annotated[str, "Table name"],
        column_name: Annotated[str, "Column name to analyse"],
        conn_name: Annotated[str, "Connection name"] = "default",
    ) -> str:
        """
        Detailed stats for a single column.

        - Numeric column → min/max/avg/stddev/median/Q1/Q3
        - Date/timestamp column → min/max range (days)
        - Text/categorical column → top-10 values with counts and ratios
        """
        try:
            _check(conn_name, "column_stats")
        except PermissionDeniedError as e:
            return _deny(e)

        conn = _conn(conn_name)
        tbl = _safe_ident(table_name)
        col_q = _safe_ident(column_name)

        try:
            insp = sa_inspect(conn.engine)
            cols = {c["name"]: str(c["type"]).lower() for c in insp.get_columns(table_name)}
        except Exception as exc:
            return json.dumps({"error": f"無法檢視欄位: {exc}"}, ensure_ascii=False)

        if column_name not in cols:
            return json.dumps(
                {"error": f"欄位 {column_name} 不存在於 {table_name}",
                 "available": list(cols.keys())},
                ensure_ascii=False,
            )

        col_type = cols[column_name]
        is_numeric = any(k in col_type for k in (
            "int", "numeric", "decimal", "float", "double", "real", "money"
        ))
        is_temporal = any(k in col_type for k in ("date", "time", "timestamp"))

        out: dict[str, Any] = {"table": table_name, "column": column_name, "type": col_type}

        if is_numeric:
            try:
                row = conn.execute(f"""
                    SELECT
                      MIN({col_q})::text  AS min,
                      MAX({col_q})::text  AS max,
                      AVG({col_q}::numeric)::numeric(20,4) AS avg,
                      STDDEV({col_q}::numeric)::numeric(20,4) AS stddev,
                      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY {col_q}::numeric) AS q1,
                      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY {col_q}::numeric) AS median,
                      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY {col_q}::numeric) AS q3,
                      SUM(CASE WHEN {col_q} IS NULL THEN 1 ELSE 0 END) AS nulls,
                      COUNT(*) AS n
                    FROM {tbl}
                """)[0]
                out.update({"kind": "numeric", **row})
            except Exception as exc:
                out["error"] = f"數值統計失敗: {exc}"
        elif is_temporal:
            try:
                row = conn.execute(f"""
                    SELECT
                      MIN({col_q})::text AS min_ts,
                      MAX({col_q})::text AS max_ts,
                      COUNT(*) AS n,
                      SUM(CASE WHEN {col_q} IS NULL THEN 1 ELSE 0 END) AS nulls
                    FROM {tbl}
                """)[0]
                out.update({"kind": "temporal", **row})
            except Exception as exc:
                out["error"] = f"時間統計失敗: {exc}"
        else:
            try:
                rows = conn.execute(f"""
                    SELECT {col_q}::text AS value, COUNT(*) AS cnt
                    FROM {tbl}
                    WHERE {col_q} IS NOT NULL
                    GROUP BY {col_q}
                    ORDER BY cnt DESC
                    LIMIT 10
                """)
                total = conn.execute(f"SELECT COUNT(*) AS n FROM {tbl}")[0]["n"]
                for r in rows:
                    r["ratio"] = round(r["cnt"] / total, 4) if total else 0
                out.update({
                    "kind": "categorical",
                    "top_values": rows,
                    "row_count": int(total),
                })
            except Exception as exc:
                out["error"] = f"類別統計失敗: {exc}"

        return json.dumps(out, ensure_ascii=False, default=str)

    # ── 3. sample_rows ───────────────────────────────────────────────────────
    @tool
    def sample_rows(
        table_name: Annotated[str, "Table name"],
        n: Annotated[int, "Number of random rows (1~50)"] = 10,
        conn_name: Annotated[str, "Connection name"] = "default",
    ) -> str:
        """
        Return N RANDOMLY sampled rows.  Unlike LIMIT, this gives a
        representative cross-section of the data.
        """
        try:
            _check(conn_name, "sample_rows")
        except PermissionDeniedError as e:
            return _deny(e)
        n = max(1, min(int(n or 10), 50))
        conn = _conn(conn_name)
        tbl = _safe_ident(table_name)
        try:
            rows = conn.execute(
                f"SELECT * FROM {tbl} ORDER BY RANDOM() LIMIT {n}"
            )
        except Exception as exc:
            return json.dumps({"error": f"取樣失敗: {exc}"}, ensure_ascii=False)
        return json.dumps(rows, ensure_ascii=False, default=str)

    # ── 4. distinct_values ───────────────────────────────────────────────────
    @tool
    def distinct_values(
        table_name: Annotated[str, "Table name"],
        column_name: Annotated[str, "Column name"],
        limit: Annotated[int, "Max distinct values to return (1~100)"] = 30,
        conn_name: Annotated[str, "Connection name"] = "default",
    ) -> str:
        """
        Return the distinct values of a column with their frequency counts.
        Useful before filtering on a categorical column whose valid values you don't know.
        """
        try:
            _check(conn_name, "distinct_values")
        except PermissionDeniedError as e:
            return _deny(e)

        limit = max(1, min(int(limit or 30), 100))
        conn = _conn(conn_name)
        tbl = _safe_ident(table_name)
        col_q = _safe_ident(column_name)
        try:
            total = conn.execute(f"SELECT COUNT(DISTINCT {col_q}) AS n FROM {tbl}")[0]["n"]
            rows = conn.execute(f"""
                SELECT {col_q}::text AS value, COUNT(*) AS cnt
                FROM {tbl}
                GROUP BY {col_q}
                ORDER BY cnt DESC
                LIMIT {limit}
            """)
        except Exception as exc:
            return json.dumps({"error": f"distinct 失敗: {exc}"}, ensure_ascii=False)
        return json.dumps({
            "table": table_name, "column": column_name,
            "distinct_total": int(total or 0),
            "shown": len(rows),
            "values": rows,
        }, ensure_ascii=False, default=str)

    # ── 5. find_relations ────────────────────────────────────────────────────
    @tool
    def find_relations(
        table_name: Annotated[str, "Anchor table"],
        conn_name: Annotated[str, "Connection name"] = "default",
    ) -> str:
        """
        Suggest probable JOIN keys between `table_name` and other tables.

        Combines declared foreign keys with heuristic column-name matching
        (e.g. `customer_id` ↔ `customers.id`).
        Use this to plan multi-table queries without guessing.
        """
        try:
            _check(conn_name, "find_relations")
        except PermissionDeniedError as e:
            return _deny(e)

        conn = _conn(conn_name)
        try:
            insp = sa_inspect(conn.engine)
            all_tables = insp.get_table_names()
            if table_name not in all_tables:
                return json.dumps(
                    {"error": f"表 {table_name} 不存在",
                     "available": all_tables},
                    ensure_ascii=False,
                )
            target_cols = {c["name"] for c in insp.get_columns(table_name)}
            target_fks = insp.get_foreign_keys(table_name) or []
        except Exception as exc:
            return json.dumps({"error": f"無法檢視 schema: {exc}"}, ensure_ascii=False)

        declared: list[dict] = []
        for fk in target_fks:
            declared.append({
                "kind": "declared_fk",
                "local_columns": fk.get("constrained_columns"),
                "ref_table": fk.get("referred_table"),
                "ref_columns": fk.get("referred_columns"),
            })

        heuristic: list[dict] = []
        # Heuristic: target.foo_id ↔ foo.id  (or foo.foo_id)
        for col in target_cols:
            if not col.endswith("_id"):
                continue
            base = col[:-3]
            for cand in (base, base + "s", base.rstrip("y") + "ies"):
                if cand in all_tables and cand != table_name:
                    try:
                        cand_cols = {c["name"] for c in insp.get_columns(cand)}
                    except Exception:
                        continue
                    if "id" in cand_cols:
                        heuristic.append({
                            "kind": "name_match",
                            "local_column": col,
                            "ref_table": cand,
                            "ref_column": "id",
                        })

        # Reverse: other tables that reference this one via <singular>_id
        reverse: list[dict] = []
        sing = table_name[:-1] if table_name.endswith("s") else table_name
        probe_col = f"{sing}_id"
        for tname in all_tables:
            if tname == table_name:
                continue
            try:
                cols = {c["name"] for c in insp.get_columns(tname)}
            except Exception:
                continue
            if probe_col in cols and "id" in target_cols:
                reverse.append({
                    "kind": "reverse_name_match",
                    "referencing_table": tname,
                    "referencing_column": probe_col,
                    "local_column": "id",
                })

        return json.dumps({
            "table": table_name,
            "declared_foreign_keys": declared,
            "heuristic_joins": heuristic,
            "referenced_by": reverse,
        }, ensure_ascii=False)

    # ── 6. time_range ────────────────────────────────────────────────────────
    @tool
    def time_range(
        table_name: Annotated[str, "Table name"],
        column_name: Annotated[str, "Timestamp/date column"],
        conn_name: Annotated[str, "Connection name"] = "default",
    ) -> str:
        """
        Show the actual min/max of a date/timestamp column and its span in days.
        Use this BEFORE applying a date filter so you don't query an empty window.
        """
        try:
            _check(conn_name, "time_range")
        except PermissionDeniedError as e:
            return _deny(e)
        conn = _conn(conn_name)
        tbl = _safe_ident(table_name)
        col_q = _safe_ident(column_name)
        try:
            row = conn.execute(f"""
                SELECT
                  MIN({col_q})::text AS min_ts,
                  MAX({col_q})::text AS max_ts,
                  COUNT(*) AS rows_with_value,
                  EXTRACT(DAY FROM MAX({col_q})::timestamp - MIN({col_q})::timestamp)::int AS span_days
                FROM {tbl}
                WHERE {col_q} IS NOT NULL
            """)[0]
        except Exception as exc:
            return json.dumps({"error": f"time_range 失敗: {exc}"}, ensure_ascii=False)
        return json.dumps({"table": table_name, "column": column_name, **row},
                          ensure_ascii=False, default=str)

    # ── 7. detect_outliers ───────────────────────────────────────────────────
    @tool
    def detect_outliers(
        table_name: Annotated[str, "Table name"],
        column_name: Annotated[str, "Numeric column"],
        method: Annotated[str, "Outlier method: 'iqr' (default) or 'zscore'"] = "iqr",
        conn_name: Annotated[str, "Connection name"] = "default",
    ) -> str:
        """
        Identify outlier rows in a numeric column.

        Method 'iqr':    rows where value < Q1 - 1.5*IQR  or > Q3 + 1.5*IQR
        Method 'zscore': rows where |value - mean| / stddev > 3
        Returns count + up to 10 example rows.
        """
        try:
            _check(conn_name, "detect_outliers")
        except PermissionDeniedError as e:
            return _deny(e)

        conn = _conn(conn_name)
        tbl = _safe_ident(table_name)
        col_q = _safe_ident(column_name)

        try:
            if method.lower() == "zscore":
                stats = conn.execute(f"""
                    SELECT AVG({col_q}::numeric) AS mu,
                           STDDEV({col_q}::numeric) AS sd
                    FROM {tbl} WHERE {col_q} IS NOT NULL
                """)[0]
                mu, sd = float(stats["mu"] or 0), float(stats["sd"] or 0)
                if sd == 0:
                    return json.dumps({"method": "zscore", "warning": "標準差為 0，無法判定離群"}, ensure_ascii=False)
                lower, upper = mu - 3 * sd, mu + 3 * sd
            else:
                stats = conn.execute(f"""
                    SELECT
                      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY {col_q}::numeric) AS q1,
                      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY {col_q}::numeric) AS q3
                    FROM {tbl} WHERE {col_q} IS NOT NULL
                """)[0]
                q1, q3 = float(stats["q1"] or 0), float(stats["q3"] or 0)
                iqr = q3 - q1
                lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr

            cnt = conn.execute(f"""
                SELECT COUNT(*) AS n FROM {tbl}
                WHERE {col_q}::numeric < {lower} OR {col_q}::numeric > {upper}
            """)[0]["n"]
            examples = conn.execute(f"""
                SELECT * FROM {tbl}
                WHERE {col_q}::numeric < {lower} OR {col_q}::numeric > {upper}
                ORDER BY {col_q}::numeric DESC
                LIMIT 10
            """)
        except Exception as exc:
            return json.dumps({"error": f"離群檢測失敗: {exc}"}, ensure_ascii=False)

        return json.dumps({
            "table": table_name, "column": column_name, "method": method,
            "lower_bound": round(float(lower), 4),
            "upper_bound": round(float(upper), 4),
            "outlier_count": int(cnt or 0),
            "examples": examples,
        }, ensure_ascii=False, default=str)

    # ── 8. compare_periods ───────────────────────────────────────────────────
    @tool
    def compare_periods(
        table_name: Annotated[str, "Source table"],
        date_column: Annotated[str, "Date/timestamp column"],
        metric_sql: Annotated[str, "Metric expression, e.g. 'SUM(total)' or 'COUNT(*)'"],
        current_start: Annotated[str, "Current period start (YYYY-MM-DD)"],
        current_end: Annotated[str, "Current period end (YYYY-MM-DD, inclusive)"],
        previous_start: Annotated[str, "Previous period start (YYYY-MM-DD)"],
        previous_end: Annotated[str, "Previous period end (YYYY-MM-DD, inclusive)"],
        conn_name: Annotated[str, "Connection name"] = "default",
    ) -> str:
        """
        Compute a metric for two periods and return absolute + percentage change.

        Use this for MoM / YoY / WoW comparisons WITHOUT writing two separate queries.
        `metric_sql` is the aggregate expression (no SELECT, no FROM, no WHERE).
        """
        try:
            _check(conn_name, "compare_periods")
        except PermissionDeniedError as e:
            return _deny(e)

        # Defensive: forbid semicolons in metric_sql (prevent multi-statement injection)
        if ";" in metric_sql or "--" in metric_sql:
            return json.dumps({"error": "metric_sql 不可包含 ';' 或 '--'"}, ensure_ascii=False)

        conn = _conn(conn_name)
        tbl = _safe_ident(table_name)
        col_q = _safe_ident(date_column)
        try:
            row = conn.execute(f"""
                SELECT
                  ( SELECT {metric_sql} FROM {tbl}
                    WHERE {col_q}::date BETWEEN '{current_start}' AND '{current_end}'
                  ) AS current_value,
                  ( SELECT {metric_sql} FROM {tbl}
                    WHERE {col_q}::date BETWEEN '{previous_start}' AND '{previous_end}'
                  ) AS previous_value
            """)[0]
        except Exception as exc:
            return json.dumps({"error": f"期間比較失敗: {exc}"}, ensure_ascii=False)

        cur = float(row.get("current_value") or 0)
        prev = float(row.get("previous_value") or 0)
        delta = cur - prev
        pct = (delta / prev * 100) if prev else None

        return json.dumps({
            "metric": metric_sql,
            "current_period": [current_start, current_end],
            "previous_period": [previous_start, previous_end],
            "current_value": cur,
            "previous_value": prev,
            "absolute_change": round(delta, 4),
            "percentage_change": round(pct, 2) if pct is not None else None,
            "direction": "up" if delta > 0 else ("down" if delta < 0 else "flat"),
        }, ensure_ascii=False, default=str)

    return [
        profile_table,
        column_stats,
        sample_rows,
        distinct_values,
        find_relations,
        time_range,
        detect_outliers,
        compare_periods,
    ]
