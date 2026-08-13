from __future__ import annotations

from langchain_core.language_models import BaseChatModel

from .base import BaseLLMAdapter


class AnthropicAdapter(BaseLLMAdapter):
    """Anthropic Claude adapter."""

    def __init__(
        self,
        api_key: str,
        model: str = "claude-sonnet-4-5",
        temperature: float = 0.0,
        max_tokens: int = 4096,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._temperature = temperature
        self._max_tokens = max_tokens

    def get_model(self, **kwargs) -> BaseChatModel:
        from langchain_anthropic import ChatAnthropic  # lazy import

        return ChatAnthropic(
            api_key=self._api_key,
            model=self._model,
            temperature=self._temperature,
            max_tokens=self._max_tokens,
            **kwargs,
        )


class BedrockAdapter(BaseLLMAdapter):
    """AWS Bedrock adapter."""

    def __init__(
        self,
        model_id: str = "anthropic.claude-3-5-sonnet-20241022-v2:0",
        region: str = "ap-northeast-1",
        temperature: float = 0.0,
        max_tokens: int = 4096,
    ) -> None:
        self._model_id = model_id
        self._region = region
        self._temperature = temperature
        self._max_tokens = max_tokens

    def get_model(self, **kwargs) -> BaseChatModel:
        from langchain_aws import ChatBedrock  # lazy import

        return ChatBedrock(
            model_id=self._model_id,
            region_name=self._region,
            model_kwargs={"temperature": self._temperature, "max_tokens": self._max_tokens},
            **kwargs,
        )
