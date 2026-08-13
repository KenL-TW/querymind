"""
QueryMind RBAC — Role-Based Access Control for database operations.

This module defines the permission model independently of any framework
or DB backend, so it can be unit-tested in isolation.

Roles (built-in, ordered by privilege):
  viewer    — SELECT only, no exports
  analyst   — SELECT + EXPLAIN, export CSV/Excel, schedule reports
  editor    — analyst + INSERT/UPDATE/MERGE (no DELETE/DDL)
  dba       — editor + DELETE + CREATE/ALTER  (still blocks DROP/TRUNCATE)
  owner     — everything (only role allowed to manage users/keys)

Custom roles can be registered via `register_role()` at startup.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Iterable

logger = logging.getLogger(__name__)

# ── SQL verb extraction ──────────────────────────────────────────────────────

_SQL_COMMENT_RE = re.compile(r"/\*.*?\*/|--[^\n]*", re.DOTALL)
_SQL_VERB_RE = re.compile(r"^\s*([A-Za-z]+)")


def extract_sql_verb(sql: str) -> str:
    """Return the leading verb of a SQL statement in upper case ('' if empty)."""
    cleaned = _SQL_COMMENT_RE.sub(" ", sql or "").lstrip()
    m = _SQL_VERB_RE.match(cleaned)
    return m.group(1).upper() if m else ""


# Verbs that are *always* forbidden, regardless of role. These are operations
# that cause irreversible data/schema loss with no business-critical use case
# from an AI assistant.
GLOBAL_FORBIDDEN_VERBS: frozenset[str] = frozenset({
    "DROP", "TRUNCATE", "GRANT", "REVOKE", "SHUTDOWN",
})


# ── Role model ───────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Role:
    name: str
    description: str
    allowed_sql_verbs: frozenset[str]
    allowed_tools: frozenset[str] | None      # None = wildcard
    max_rows_per_query: int = 10_000
    can_export: bool = True
    can_schedule: bool = False
    can_etl: bool = False
    can_manage_users: bool = False
    can_modify_schema: bool = False

    def allows_verb(self, verb: str) -> bool:
        v = verb.upper()
        if v in GLOBAL_FORBIDDEN_VERBS:
            return False
        return v in self.allowed_sql_verbs

    def allows_tool(self, tool_name: str) -> bool:
        if self.allowed_tools is None:
            return True
        return tool_name in self.allowed_tools


# ── Built-in roles ───────────────────────────────────────────────────────────

_READ_VERBS = frozenset({"SELECT", "EXPLAIN", "WITH", "SHOW", "DESCRIBE", "DESC", "PRAGMA"})
_WRITE_VERBS = _READ_VERBS | {"INSERT", "UPDATE", "MERGE", "REPLACE"}
_DBA_VERBS = _WRITE_VERBS | {"DELETE", "CREATE", "ALTER"}
_FULL_VERBS = _DBA_VERBS  # owner gets full DBA + admin features


BUILTIN_ROLES: dict[str, Role] = {
    "viewer": Role(
        name="viewer",
        description="僅可瀏覽資料（SELECT），不能匯出或排程。",
        allowed_sql_verbs=_READ_VERBS,
        allowed_tools=frozenset({
            "execute_query", "list_tables", "list_schemas",
            "get_table_ddl", "list_connections", "explain_query",
            "profile_table", "column_stats", "sample_rows",
            "distinct_values", "find_relations", "time_range",
            "detect_outliers", "compare_periods",
            "describe_semantic_layer", "build_query_plan", "execute_query_plan",
            "resolve_schema_for_question", "validate_sql_dry_run_tool",
            "diagnose_empty_sql_result", "build_agent_flow_trace_tool",
        }),
        max_rows_per_query=1_000,
        can_export=False,
    ),
    "analyst": Role(
        name="analyst",
        description="資料分析師：可查詢、匯出、排程報表，但不能寫入資料。",
        allowed_sql_verbs=_READ_VERBS,
        allowed_tools=None,  # full tool access for read+ETL preview
        max_rows_per_query=50_000,
        can_export=True,
        can_schedule=True,
        can_etl=False,
    ),
    "editor": Role(
        name="editor",
        description="資料維護人員：可 INSERT/UPDATE，可執行 ETL 寫入，不能 DELETE。",
        allowed_sql_verbs=_WRITE_VERBS,
        allowed_tools=None,
        max_rows_per_query=100_000,
        can_export=True,
        can_schedule=True,
        can_etl=True,
    ),
    "dba": Role(
        name="dba",
        description="資料庫管理員：可 DELETE / CREATE / ALTER，仍封鎖 DROP / TRUNCATE。",
        allowed_sql_verbs=_DBA_VERBS,
        allowed_tools=None,
        max_rows_per_query=1_000_000,
        can_export=True,
        can_schedule=True,
        can_etl=True,
        can_modify_schema=True,
    ),
    "owner": Role(
        name="owner",
        description="擁有者：所有 DB 權限 + 可管理使用者與 API Key。",
        allowed_sql_verbs=_FULL_VERBS,
        allowed_tools=None,
        max_rows_per_query=10_000_000,
        can_export=True,
        can_schedule=True,
        can_etl=True,
        can_manage_users=True,
        can_modify_schema=True,
    ),
}


_REGISTRY: dict[str, Role] = dict(BUILTIN_ROLES)


def get_role(name: str) -> Role:
    """Return the Role for `name`, falling back to `viewer` (safe default)."""
    role = _REGISTRY.get((name or "").lower())
    return role or _REGISTRY["viewer"]


def list_roles() -> list[Role]:
    return list(_REGISTRY.values())


def register_role(role: Role) -> None:
    """Plug in a custom role definition at startup."""
    _REGISTRY[role.name.lower()] = role


# ── User context object ──────────────────────────────────────────────────────

@dataclass
class UserContext:
    """Represents the authenticated caller for one request."""
    user_id: str
    email: str = ""
    role_name: str = "viewer"
    display_name: str = ""
    allowed_conns: list[str] = field(default_factory=list)   # empty = all
    api_key_prefix: str = ""

    @property
    def role(self) -> Role:
        return get_role(self.role_name)

    def can_use_conn(self, conn_name: str) -> bool:
        return (not self.allowed_conns) or conn_name in self.allowed_conns

    def _capabilities(self) -> list[str]:
        """Derive a flat capability list for the frontend RBAC checks."""
        r = self.role
        # Owner / wildcard-tools roles get the '*' shortcut
        if r.allowed_tools is None and r.can_manage_users:
            return ["*"]
        caps: list[str] = []
        # query: can execute SELECT-family statements
        if r.allows_verb("SELECT"):
            caps.append("query")
        # view_schema: can inspect schema objects
        if r.allowed_tools is None or "list_tables" in r.allowed_tools:
            caps.append("view_schema")
        if r.can_export:
            caps.append("export")
        if r.can_schedule:
            caps.append("schedule")
        if r.can_etl:
            caps.append("etl")
        if r.can_manage_users:
            caps.append("manage_users")
        if r.can_modify_schema:
            caps.append("modify_schema")
        return caps

    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "email": self.email,
            "display_name": self.display_name,
            # role_name is what the frontend MeUser interface expects
            "role_name": self.role_name,
            # kept for backward-compat with any existing API consumers
            "role": self.role_name,
            "allowed_conns": self.allowed_conns,
            # flat capability list consumed by frontend hasCapability()
            "capabilities": self._capabilities(),
            "permissions": {
                "max_rows_per_query": self.role.max_rows_per_query,
                "can_export":     self.role.can_export,
                "can_schedule":   self.role.can_schedule,
                "can_etl":        self.role.can_etl,
                "can_manage_users": self.role.can_manage_users,
                "can_modify_schema": self.role.can_modify_schema,
                "allowed_sql_verbs": sorted(self.role.allowed_sql_verbs),
            },
        }


# Anonymous user — used when AUTH_ENABLED=false. Defaults to owner so that
# all existing local-dev flows continue to work unchanged.
ANONYMOUS_USER = UserContext(
    user_id="anonymous",
    email="anonymous@local",
    role_name="owner",
    display_name="Anonymous",
    api_key_prefix="anon",
)


# ── Permission errors ────────────────────────────────────────────────────────

class PermissionDeniedError(Exception):
    """Raised when a tool call or SQL statement is rejected by RBAC."""


def assert_sql_allowed(user: UserContext, sql: str) -> str:
    """Validate that `user.role` may execute `sql`. Returns the parsed verb on success."""
    verb = extract_sql_verb(sql)
    if not verb:
        raise PermissionDeniedError("無法解析 SQL 語句的動詞。")
    if verb in GLOBAL_FORBIDDEN_VERBS:
        raise PermissionDeniedError(
            f"[安全限制] {verb} 在系統全域被禁止，無人可執行。"
        )
    if not user.role.allows_verb(verb):
        raise PermissionDeniedError(
            f"[權限不足] 您的角色 `{user.role_name}` 不允許執行 {verb}。"
            f" 允許的動詞：{', '.join(sorted(user.role.allowed_sql_verbs))}"
        )
    return verb


def assert_conn_allowed(user: UserContext, conn_name: str) -> None:
    if not user.can_use_conn(conn_name):
        raise PermissionDeniedError(
            f"[權限不足] 您無權存取資料庫連線 `{conn_name}`。"
            f" 可用連線：{', '.join(user.allowed_conns) or '無'}"
        )


def assert_tool_allowed(user: UserContext, tool_name: str) -> None:
    """Reject if the user's role doesn't whitelist this tool name."""
    if not user.role.allows_tool(tool_name):
        raise PermissionDeniedError(
            f"[權限不足] 角色 `{user.role_name}` 不可使用工具 `{tool_name}`。"
        )


_CAPABILITY_LABEL_ZH = {
    "can_export": "匯出資料",
    "can_schedule": "建立排程",
    "can_etl": "執行 ETL 寫入",
    "can_manage_users": "管理使用者",
    "can_modify_schema": "修改 schema",
}


def assert_capability(user: UserContext, cap: str) -> None:
    """Reject if user's role lacks the requested boolean capability flag."""
    if not getattr(user.role, cap, False):
        label = _CAPABILITY_LABEL_ZH.get(cap, cap)
        raise PermissionDeniedError(
            f"[權限不足] 角色 `{user.role_name}` 不可{label}。"
        )


def role_prompt_addendum(user: UserContext) -> str:
    """A short paragraph injected into the system prompt to teach the LLM about the caller's limits."""
    r = user.role
    verbs = ", ".join(sorted(r.allowed_sql_verbs))
    extras = []
    if r.can_export:   extras.append("可匯出 CSV/Excel")
    if r.can_schedule: extras.append("可排程")
    if r.can_etl:      extras.append("可執行 ETL 寫入")
    if r.can_modify_schema: extras.append("可調整 schema")
    if r.can_manage_users:  extras.append("可管理使用者")
    if not extras:
        extras.append("僅唯讀")
    return (
        f"\n## 當前使用者授權\n"
        f"- 使用者: `{user.email or user.user_id}`\n"
        f"- 角色: `{r.name}` — {r.description}\n"
        f"- 允許的 SQL 動詞: {verbs}\n"
        f"- 單次查詢列數上限: {r.max_rows_per_query:,}\n"
        f"- 可用連線: {', '.join(user.allowed_conns) or '所有'}\n"
        f"- 額外能力: {', '.join(extras)}\n"
        f"- **若使用者要求超出授權的操作，請禮貌拒絕並建議他聯絡 owner。**\n"
    )
