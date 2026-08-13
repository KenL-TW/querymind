from __future__ import annotations

from langchain_core.language_models import BaseChatModel
from langchain_openai import ChatOpenAI

from .base import BaseLLMAdapter


class OpenAIAdapter(BaseLLMAdapter):
    """OpenAI GPT adapter — default provider."""

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4o",
        temperature: float = 0.0,
        max_tokens: int = 2048,
        timeout: int = 120,
        max_retries: int = 6,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._temperature = temperature
        self._max_tokens = max_tokens
        self._timeout = timeout
        self._max_retries = max_retries

    def get_model(self, **kwargs) -> BaseChatModel:
        # ``stream_usage=True`` ensures that streamed chunks carry usage_metadata
        # so token-cost analytics works for the agent path (LangChain's
        # AgentExecutor streams internally even on .invoke()).
        kwargs.setdefault("stream_usage", True)
        return ChatOpenAI(
            api_key=self._api_key,
            model=self._model,
            temperature=self._temperature,
            max_tokens=self._max_tokens,
            timeout=self._timeout,
            max_retries=self._max_retries,
            **kwargs,
        )
