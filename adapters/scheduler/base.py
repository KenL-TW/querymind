from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass
class ScheduleRecord:
    schedule_id: str
    name: str
    cron_expression: str
    target: str          # e.g. Lambda ARN or task name
    payload: dict
    enabled: bool
    created_at: datetime | None = None


class BaseSchedulerAdapter(ABC):
    """Interface for pluggable scheduler backends."""

    @abstractmethod
    def create_schedule(
        self,
        name: str,
        cron_expression: str,
        target: str,
        payload: dict[str, Any],
    ) -> ScheduleRecord:
        """Create a new scheduled task."""

    @abstractmethod
    def list_schedules(self) -> list[ScheduleRecord]:
        """Return all managed schedules."""

    @abstractmethod
    def delete_schedule(self, schedule_id: str) -> bool:
        """Delete a schedule by ID. Returns True if deleted."""

    @abstractmethod
    def get_schedule(self, schedule_id: str) -> ScheduleRecord | None:
        """Fetch a single schedule by ID."""
