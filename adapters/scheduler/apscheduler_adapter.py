from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from .base import BaseSchedulerAdapter, ScheduleRecord

logger = logging.getLogger(__name__)

_scheduler = BackgroundScheduler()
_scheduler.start()


class APSchedulerAdapter(BaseSchedulerAdapter):
    """
    In-process scheduler using APScheduler.

    Each scheduled job executes ``target`` as a SQL query against the connection
    identified by ``payload["conn_name"]``.  Results are logged at INFO level.

    Payload contract::

        {
            "conn_name": "my_db",          # required — connection key in registry
            "description": "...",          # optional — human-readable note
        }

    The ``target`` field is treated as a raw SQL SELECT statement.
    """

    def __init__(
        self,
        registry=None,          # db.registry.ConnectionRegistry
        session_factory=None,   # sqlalchemy sessionmaker (for audit log, future use)
    ) -> None:
        self._registry = registry
        self._session_factory = session_factory
        self._records: dict[str, ScheduleRecord] = {}

    def create_schedule(
        self,
        name: str,
        cron_expression: str,
        target: str,
        payload: dict[str, Any],
    ) -> ScheduleRecord:
        schedule_id = str(uuid.uuid4())
        registry = self._registry   # capture for closure

        def _job() -> None:
            conn_name: str = payload.get("conn_name", "")
            logger.info(
                "Scheduled job fired",
                extra={"schedule_id": schedule_id, "sched_name": name, "conn_name": conn_name},
            )
            if not registry or not conn_name:
                logger.warning(
                    "Scheduled job skipped — no registry or conn_name",
                    extra={"schedule_id": schedule_id},
                )
                return
            try:
                connector = registry.get(conn_name)
                rows = connector.execute(target)
                logger.info(
                    "Scheduled job executed",
                    extra={
                        "schedule_id": schedule_id,
                        "sched_name": name,
                        "conn_name": conn_name,
                        "rows_returned": len(rows),
                    },
                )
            except Exception as exc:
                logger.error(
                    "Scheduled job failed",
                    extra={
                        "schedule_id": schedule_id,
                        "sched_name": name,
                        "conn_name": conn_name,
                        "error": str(exc),
                    },
                )

        _scheduler.add_job(
            _job,
            CronTrigger.from_crontab(cron_expression),
            id=schedule_id,
            name=name,
        )

        record = ScheduleRecord(
            schedule_id=schedule_id,
            name=name,
            cron_expression=cron_expression,
            target=target,
            payload=payload,
            enabled=True,
            created_at=datetime.now(timezone.utc),
        )
        self._records[schedule_id] = record
        logger.info("Schedule created", extra={"id": schedule_id, "sched_name": name})
        return record

    def list_schedules(self) -> list[ScheduleRecord]:
        return list(self._records.values())

    def delete_schedule(self, schedule_id: str) -> bool:
        if schedule_id not in self._records:
            return False
        try:
            _scheduler.remove_job(schedule_id)
        except Exception:
            pass
        del self._records[schedule_id]
        return True

    def get_schedule(self, schedule_id: str) -> ScheduleRecord | None:
        return self._records.get(schedule_id)
