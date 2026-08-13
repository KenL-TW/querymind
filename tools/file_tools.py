from __future__ import annotations

import json
import logging
from typing import Annotated

from langchain_core.tools import tool

from adapters.storage.base import BaseStorageAdapter

logger = logging.getLogger(__name__)


def make_file_tools(storage: BaseStorageAdapter):
    """Return file management tools bound to the given storage adapter."""

    @tool
    def list_files(
        prefix: Annotated[str, "Optional key prefix to filter results"] = "",
    ) -> str:
        """List files stored in the archive (local or S3) under the given prefix."""
        keys = storage.list_keys(prefix)
        return json.dumps(keys)

    @tool
    def download_file(
        key: Annotated[str, "Storage key of the file to read"],
    ) -> str:
        """Download and return the content of a file from storage."""
        if not storage.exists(key):
            return f"File not found: {key}"
        return storage.download(key)

    @tool
    def upload_file(
        key: Annotated[str, "Storage key / path for the file"],
        content: Annotated[str, "Text content to write"],
    ) -> str:
        """Upload text content to storage under the given key."""
        result_key = storage.upload(key, content)
        return f"Uploaded to: {result_key}"

    return [list_files, download_file, upload_file]
