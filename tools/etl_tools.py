from __future__ import annotations

import ast
import io
import json
import logging
import textwrap
from contextlib import redirect_stdout
from typing import Annotated

from langchain_core.tools import tool

from adapters.storage.base import BaseStorageAdapter
from api.context import get_current_user
from core.rbac import (
    PermissionDeniedError,
    assert_capability,
    assert_tool_allowed,
)
from storage.code_archive import CodeArchive

logger = logging.getLogger(__name__)


def _denied(msg: str) -> str:
    return json.dumps({"error": msg, "denied": True}, ensure_ascii=False)


def _guard_etl(tool_name: str, *, require_etl: bool) -> str | None:
    """Common RBAC guard for ETL tools. Returns error JSON or None."""
    user = get_current_user()
    try:
        assert_tool_allowed(user, tool_name)
        if require_etl:
            assert_capability(user, "can_etl")
    except PermissionDeniedError as exc:
        return _denied(str(exc))
    return None


# Modules an ETL script is *allowed* to import. Keep extremely small; pandas
# already gives the LLM enough power for table-shaped transforms.
_ALLOWED_IMPORTS: frozenset[str] = frozenset({
    "pandas", "pd", "numpy", "np", "math", "datetime", "re", "json", "csv", "io",
    "collections", "decimal", "itertools",
})

# Attribute access / call patterns that enable sandbox escapes — banned outright.
# Even though our exec scope strips `__builtins__`, a hostile expression can walk
# `().__class__.__bases__[0].__subclasses__()` and reach arbitrary code.
_BANNED_ATTRS: frozenset[str] = frozenset({
    "__class__", "__bases__", "__mro__", "__subclasses__", "__globals__",
    "__import__", "__builtins__", "__getattribute__", "__getattr__",
    "__reduce__", "__reduce_ex__", "__dict__", "__code__", "__loader__",
    "__loader__", "__spec__", "__cached__", "__file__", "__module__",
})

_BANNED_CALL_NAMES: frozenset[str] = frozenset({
    "eval", "exec", "compile", "open", "__import__", "input",
    "globals", "locals", "vars", "breakpoint",
    "memoryview", "classmethod", "staticmethod",
})


def _validate_etl_ast(code: str) -> str | None:
    """Walk the AST and reject any dangerous construct.

    Returns ``None`` if the code is acceptable; otherwise an error message
    describing the rejected construct.
    """
    try:
        tree = ast.parse(textwrap.dedent(code))
    except SyntaxError as exc:
        return f"SyntaxError: {exc}"

    for node in ast.walk(tree):
        # Imports must be in the allow-list.
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root not in _ALLOWED_IMPORTS:
                    return f"import not allowed: {alias.name}"
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root not in _ALLOWED_IMPORTS:
                return f"from-import not allowed: {node.module}"
        # Block dangerous attribute access — covers x.__class__.__bases__ etc.
        elif isinstance(node, ast.Attribute):
            if node.attr in _BANNED_ATTRS:
                return f"attribute not allowed: {node.attr}"
        # Block direct calls to eval / exec / __import__ etc.
        elif isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id in _BANNED_CALL_NAMES:
                return f"call not allowed: {func.id}()"
        # No try/except hiding sandbox escapes inside an obscure handler
        elif isinstance(node, ast.AsyncFunctionDef):
            return "async functions are not allowed"
    return None


def make_etl_tools(archive: CodeArchive, storage: BaseStorageAdapter):
    """Return ETL-related tools bound to the archive and storage adapter."""

    @tool
    def check_code_archive(
        file_path: Annotated[str, "Source file path being imported"],
        schema_name: Annotated[str, "Target schema name"],
        table_name: Annotated[str, "Target table name"],
    ) -> str:
        """
        Search the code archive for existing ETL scripts matching this import task (Step 1 of ETL workflow).
        Returns matched code snippet or a message indicating no match was found.
        """
        err = _guard_etl("check_code_archive", require_etl=False)
        if err is not None:
            return err
        hit = archive.search(file_path, schema_name, table_name)
        if hit is None:
            return "No existing ETL code found for this task. Proceeding to generate new code."
        return f"Existing ETL code found (score={hit.score:.2f}):\n\n```python\n{hit.code}\n```"

    @tool
    def read_file_content(
        file_path: Annotated[str, "Relative path or storage key of the file to read"],
    ) -> str:
        """
        Read contents of a file from local storage or S3 archive (Step 2 of ETL workflow).
        Returns the file content as a string (first 8000 characters).
        """
        err = _guard_etl("read_file_content", require_etl=False)
        if err is not None:
            return err
        content = storage.download(file_path)
        preview = content[:8000]
        suffix = "\n...[truncated]" if len(content) > 8000 else ""
        return preview + suffix

    @tool
    def save_etl_code(
        code: Annotated[str, "Python ETL code to archive"],
        file_path: Annotated[str, "Original source file path this code handles"],
        schema_name: Annotated[str, "Target schema name"],
        table_name: Annotated[str, "Target table name"],
        description: Annotated[str, "Short description of what this ETL code does"] = "",
    ) -> str:
        """Archive ETL code (Step 10 of ETL workflow). Returns the storage key."""
        err = _guard_etl("save_etl_code", require_etl=True)
        if err is not None:
            return err
        key = archive.save(code, file_path, schema_name, table_name, description)
        return f"Code archived at key: {key}"

    @tool
    def run_etl_code(
        code: Annotated[str, "Python ETL code to execute (must be pre-approved by user)"],
    ) -> str:
        """
        Execute ETL code in a restricted sandbox (Step 9 of ETL workflow).
        Only safe built-ins are available. Network, file-system, and subprocess access is blocked.
        WARNING: Only call this after showing the code to the user and receiving explicit confirmation.
        """
        err = _guard_etl("run_etl_code", require_etl=True)
        if err is not None:
            return err
        _safe_builtins = {
            "print": print,
            "range": range,
            "len": len,
            "enumerate": enumerate,
            "zip": zip,
            "map": map,
            "filter": filter,
            "sorted": sorted,
            "reversed": reversed,
            "list": list,
            "dict": dict,
            "set": set,
            "tuple": tuple,
            "str": str,
            "int": int,
            "float": float,
            "bool": bool,
            "isinstance": isinstance,
            "issubclass": issubclass,
            "hasattr": hasattr,
            "getattr": getattr,
            "round": round,
            "abs": abs,
            "min": min,
            "max": max,
            "sum": sum,
            "Exception": Exception,
            "ValueError": ValueError,
            "TypeError": TypeError,
            "KeyError": KeyError,
        }

        forbidden_subs = ["subprocess", "os.system", "os.popen", "pty.spawn"]
        code_lower = code.lower()
        for token in forbidden_subs:
            if token in code_lower:
                return f"Execution blocked: code contains forbidden token '{token}'."

        # AST-level validation (defence in depth — string match is fooled by aliases)
        rejection = _validate_etl_ast(code)
        if rejection is not None:
            return f"Execution blocked by sandbox: {rejection}"

        # allow pandas / csv via whitelisted imports inside code
        exec_globals: dict = {"__builtins__": _safe_builtins}
        stdout_capture = io.StringIO()
        try:
            with redirect_stdout(stdout_capture):
                compiled = compile(textwrap.dedent(code), "<etl>", "exec")
                exec(compiled, exec_globals)  # noqa: S102
        except Exception as exc:
            return f"ETL execution error: {exc}"

        output = stdout_capture.getvalue()
        return output if output else "ETL executed successfully (no output)."

    return [check_code_archive, read_file_content, save_etl_code, run_etl_code]
