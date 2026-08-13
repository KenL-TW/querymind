from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path


class BaseStorageAdapter(ABC):
    """Interface for pluggable storage backends (Local FS / AWS S3)."""

    @abstractmethod
    def upload(self, key: str, content: str | bytes) -> str:
        """Upload content and return the storage URI."""

    @abstractmethod
    def download(self, key: str) -> str:
        """Download content and return as string."""

    @abstractmethod
    def exists(self, key: str) -> bool:
        """Return True if the key exists."""

    @abstractmethod
    def list_keys(self, prefix: str = "") -> list[str]:
        """List all keys matching the prefix."""

    @abstractmethod
    def delete(self, key: str) -> None:
        """Delete the given key."""
