from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from .base import BaseSchedulerAdapter, ScheduleRecord

logger = logging.getLogger(__name__)


class EventBridgeAdapter(BaseSchedulerAdapter):
    """AWS EventBridge Scheduler adapter — for production."""

    def __init__(self, region: str = "ap-northeast-1", role_arn: str = "") -> None:
        import boto3  # lazy import

        self._client = boto3.client("scheduler", region_name=region)
        self._role_arn = role_arn
        self._group = "querymind-schedules"
        self._ensure_group()

    def _ensure_group(self) -> None:
        try:
            self._client.create_schedule_group(Name=self._group)
        except self._client.exceptions.ConflictException:
            pass

    def create_schedule(
        self,
        name: str,
        cron_expression: str,
        target: str,
        payload: dict[str, Any],
    ) -> ScheduleRecord:
        schedule_id = name.replace(" ", "_") + "_" + uuid.uuid4().hex[:6]

        self._client.create_schedule(
            Name=schedule_id,
            GroupName=self._group,
            ScheduleExpression=f"cron({cron_expression})",
            FlexibleTimeWindow={"Mode": "OFF"},
            Target={
                "Arn": target,
                "RoleArn": self._role_arn,
                "Input": json.dumps(payload),
            },
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
        logger.info("EventBridge schedule created", extra={"id": schedule_id})
        return record

    def list_schedules(self) -> list[ScheduleRecord]:
        response = self._client.list_schedules(GroupName=self._group)
        records: list[ScheduleRecord] = []
        for item in response.get("Schedules", []):
            records.append(
                ScheduleRecord(
                    schedule_id=item["Name"],
                    name=item["Name"],
                    cron_expression=item.get("ScheduleExpression", ""),
                    target=item.get("Target", {}).get("Arn", ""),
                    payload={},
                    enabled=item.get("State") == "ENABLED",
                )
            )
        return records

    def delete_schedule(self, schedule_id: str) -> bool:
        try:
            self._client.delete_schedule(Name=schedule_id, GroupName=self._group)
            return True
        except Exception as exc:
            logger.error("Failed to delete EventBridge schedule", extra={"error": str(exc)})
            return False

    def get_schedule(self, schedule_id: str) -> ScheduleRecord | None:
        try:
            resp = self._client.get_schedule(Name=schedule_id, GroupName=self._group)
            return ScheduleRecord(
                schedule_id=schedule_id,
                name=resp["Name"],
                cron_expression=resp.get("ScheduleExpression", ""),
                target=resp.get("Target", {}).get("Arn", ""),
                payload={},
                enabled=resp.get("State") == "ENABLED",
            )
        except Exception:
            return None
