from __future__ import annotations

import logging
from pathlib import Path

from .base import BaseStorageAdapter

logger = logging.getLogger(__name__)


class LocalStorageAdapter(BaseStorageAdapter):
    """Store files on the local filesystem — for local dev & testing."""

    def __init__(self, base_path: str = "./data/code_archive") -> None:
        self._base = Path(base_path)
        self._base.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        # Prevent path traversal
        safe = Path(key.lstrip("/\\"))
        return self._base / safe

    def upload(self, key: str, content: str | bytes) -> str:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        mode = "wb" if isinstance(content, bytes) else "w"
        encoding = None if isinstance(content, bytes) else "utf-8"
        with open(path, mode, encoding=encoding) as fh:
            fh.write(content)
        logger.debug("Uploaded to local storage", extra={"key": key})
        return f"local://{path}"

    def download(self, key: str) -> str:
        path = self._path(key)
        if not path.exists():
            raise FileNotFoundError(f"Key not found in local storage: {key}")
        return path.read_text(encoding="utf-8")

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def list_keys(self, prefix: str = "") -> list[str]:
        search_path = self._base / prefix if prefix else self._base
        if not search_path.exists():
            return []
        return [str(p.relative_to(self._base)) for p in search_path.rglob("*") if p.is_file()]

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()
