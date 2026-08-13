from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler

from api.context import get_current_user


@dataclass
class _ToolRun:
    name: str
    input_payload: Any
    started_at: float
    conn_name: str | None


class ToolObservabilityHandler(BaseCallbackHandler):
    """Persist tool-level latency, input, output, and error telemetry."""

    def __init__(self, *, session_id: str | None = None, default_conn_name: str | None = None) -> None:
        self.session_id = session_id
        self.default_conn_name = default_conn_name
        self._runs: dict[str, _ToolRun] = {}

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: Any,
        **kwargs: Any,
    ) -> None:
        name = str(serialized.get("name") or kwargs.get("name") or "unknown_tool")
        payload = kwargs.get("inputs", input_str)
        conn_name = _extract_conn_name(payload) or self.default_conn_name
        self._runs[str(run_id)] = _ToolRun(
            name=name,
            input_payload=payload,
            started_at=time.monotonic(),
            conn_name=conn_name,
        )

    def on_tool_end(self, output: Any, *, run_id: Any, **kwargs: Any) -> None:
        run = self._runs.pop(str(run_id), None)
        if run is None:
            return
        self._log(run, output=output, error=None)

    def on_tool_error(self, error: BaseException, *, run_id: Any, **kwargs: Any) -> None:
        run = self._runs.pop(str(run_id), None)
        if run is None:
            return
        self._log(run, output=None, error=error)

    def _log(self, run: _ToolRun, *, output: Any, error: BaseException | None) -> None:
        try:
            from api.main import app_state

            audit_logger = app_state.get("audit_logger") if app_state else None
            if audit_logger is None:
                return
            user = get_current_user()
            try:
                user_id = int(user.user_id)
            except (TypeError, ValueError):
                user_id = None
            detail = {
                "input": _safe_payload(run.input_payload, 3000),
                "output": _safe_payload(output, 3000) if error is None else None,
            }
            audit_logger.log(
                "tool_call",
                session_id=self.session_id,
                user_id=user_id,
                api_key_prefix=getattr(user, "api_key_prefix", None),
                tool_name=run.name,
                conn_name=run.conn_name,
                detail=json.dumps(detail, ensure_ascii=False, default=str),
                status="error" if error else "success",
                duration_ms=int((time.monotonic() - run.started_at) * 1000),
                error_msg=str(error) if error else None,
            )
        except Exception:
            return


def _safe_payload(value: Any, limit: int) -> str:
    if hasattr(value, "content"):
        value = getattr(value, "content")
    try:
        text = json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        text = str(value)
    return text[:limit]


def _extract_conn_name(payload: Any) -> str | None:
    if isinstance(payload, dict):
        val = payload.get("conn_name")
        return str(val) if val else None
    if isinstance(payload, str):
        try:
            parsed = json.loads(payload)
        except Exception:
            return None
        if isinstance(parsed, dict) and parsed.get("conn_name"):
            return str(parsed["conn_name"])
    return None
