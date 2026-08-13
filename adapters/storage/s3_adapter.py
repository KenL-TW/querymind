from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from .base import BaseStorageAdapter

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class S3StorageAdapter(BaseStorageAdapter):
    """Store files on AWS S3 — for production use."""

    def __init__(self, bucket: str, prefix: str = "code_archive", region: str = "ap-northeast-1") -> None:
        import boto3  # lazy import — not required in local env

        self._bucket = bucket
        self._prefix = prefix.rstrip("/")
        self._s3 = boto3.client("s3", region_name=region)

    def _key(self, key: str) -> str:
        return f"{self._prefix}/{key.lstrip('/')}"

    def upload(self, key: str, content: str | bytes) -> str:
        body = content.encode("utf-8") if isinstance(content, str) else content
        full_key = self._key(key)
        self._s3.put_object(Bucket=self._bucket, Key=full_key, Body=body)
        uri = f"s3://{self._bucket}/{full_key}"
        logger.debug("Uploaded to S3", extra={"uri": uri})
        return uri

    def download(self, key: str) -> str:
        full_key = self._key(key)
        response = self._s3.get_object(Bucket=self._bucket, Key=full_key)
        return response["Body"].read().decode("utf-8")

    def exists(self, key: str) -> bool:
        import botocore.exceptions

        try:
            self._s3.head_object(Bucket=self._bucket, Key=self._key(key))
            return True
        except botocore.exceptions.ClientError:
            return False

    def list_keys(self, prefix: str = "") -> list[str]:
        full_prefix = self._key(prefix) if prefix else self._prefix
        paginator = self._s3.get_paginator("list_objects_v2")
        keys: list[str] = []
        for page in paginator.paginate(Bucket=self._bucket, Prefix=full_prefix):
            for obj in page.get("Contents", []):
                keys.append(obj["Key"].removeprefix(self._prefix + "/"))
        return keys

    def delete(self, key: str) -> None:
        self._s3.delete_object(Bucket=self._bucket, Key=self._key(key))
