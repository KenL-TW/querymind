from __future__ import annotations

from abc import ABC, abstractmethod

from langchain_core.language_models import BaseChatModel


class BaseLLMAdapter(ABC):
    """Interface for all LLM provider adapters."""

    @abstractmethod
    def get_model(self, **kwargs) -> BaseChatModel:
        """Return a LangChain-compatible chat model instance."""
