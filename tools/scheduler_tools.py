from __future__ import annotations

import json
import logging
from typing import Annotated

from langchain_core.tools import tool

from adapters.scheduler.base import BaseSchedulerAdapter
from api.context import get_current_user
from core.rbac import (
    PermissionDeniedError,
    assert_capability,
    assert_tool_allowed,
)

logger = logging.getLogger(__name__)


def _denied(msg: str) -> str:
    return json.dumps({"error": msg, "denied": True}, ensure_ascii=False)


def _guard_schedule(tool_name: str, *, require_schedule: bool) -> str | None:
    user = get_current_user()
    try:
        assert_tool_allowed(user, tool_name)
        if require_schedule:
            assert_capability(user, "can_schedule")
    except PermissionDeniedError as exc:
        return _denied(str(exc))
    return None


def make_scheduler_tools(scheduler: BaseSchedulerAdapter):
    """Return scheduler management tools bound to the given adapter."""

    @tool
    def create_schedule(
        name: Annotated[str, "Human-readable name for the schedule"],
        cron_expression: Annotated[str, "Cron expression (5 fields: minute hour day month weekday)"],
        target: Annotated[str, "Target to run — e.g. a SQL query or ETL script storage key"],
        conn_name: Annotated[str, "Database connection name to execute the target against"],
        description: Annotated[str, "Optional human-readable description"] = "",
    ) -> str:
        """Create a new scheduled task. Returns the schedule ID."""
        err = _guard_schedule("create_schedule", require_schedule=True)
        if err is not None:
            return err
        payload_dict = {"conn_name": conn_name}
        if description:
            payload_dict["description"] = description

        record = scheduler.create_schedule(
            name=name,
            cron_expression=cron_expression,
            target=target,
            payload=payload_dict,
        )
        return f"Schedule created: id={record.schedule_id}"

    @tool
    def list_schedules() -> str:
        """List all registered scheduled tasks."""
        err = _guard_schedule("list_schedules", require_schedule=False)
        if err is not None:
            return err
        records = scheduler.list_schedules()
        result = [
            {
                "id": r.schedule_id,
                "name": r.name,
                "cron": r.cron_expression,
                "target": r.target,
                "enabled": r.enabled,
            }
            for r in records
        ]
        return json.dumps(result, indent=2)

    @tool
    def delete_schedule(
        schedule_id: Annotated[str, "ID of the schedule to delete"],
    ) -> str:
        """Delete a scheduled task by ID."""
        err = _guard_schedule("delete_schedule", require_schedule=True)
        if err is not None:
            return err
        try:
            scheduler.delete_schedule(schedule_id)
        except Exception as exc:
            return f"Failed to delete schedule: {exc}"
        return f"Schedule {schedule_id} deleted."

    @tool
    def get_schedule(
        schedule_id: Annotated[str, "ID of the schedule to retrieve"],
    ) -> str:
        """Get details of a specific scheduled task."""
        err = _guard_schedule("get_schedule", require_schedule=False)
        if err is not None:
            return err
        record = scheduler.get_schedule(schedule_id)
        if record is None:
            return f"Schedule '{schedule_id}' not found."
        return json.dumps(
            {
                "id": record.schedule_id,
                "name": record.name,
                "cron": record.cron_expression,
                "target": record.target,
                "enabled": record.enabled,
                "created_at": str(record.created_at),
            },
            indent=2,
        )

    return [create_schedule, list_schedules, delete_schedule, get_schedule]
