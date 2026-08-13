from __future__ import annotations

import logging

from langchain_core.language_models import BaseChatModel

from adapters.llm.base import BaseLLMAdapter
from adapters.llm.openai_adapter import OpenAIAdapter
from config.settings import Settings

logger = logging.getLogger(__name__)

_PROVIDER_MAP: dict[str, type[BaseLLMAdapter]] = {
    "openai": OpenAIAdapter,
}


def _lazy_register() -> None:
    """Register optional providers only if their packages are installed."""
    try:
        from adapters.llm.other_adapters import AnthropicAdapter, BedrockAdapter
        _PROVIDER_MAP.setdefault("anthropic", AnthropicAdapter)
        _PROVIDER_MAP.setdefault("bedrock", BedrockAdapter)
    except ImportError:
        pass


_lazy_register()


class LLMFactory:
    """Create a LangChain BaseChatModel from application settings."""

    @staticmethod
    def create(settings: Settings, *, model: str | None = None, **overrides) -> BaseChatModel:
        provider = settings.llm_provider.lower()

        if provider not in _PROVIDER_MAP:
            raise ValueError(
                f"Unknown LLM provider '{provider}'. Available: {list(_PROVIDER_MAP)}"
            )

        adapter_cls = _PROVIDER_MAP[provider]

        if provider == "openai":
            adapter = adapter_cls(
                api_key=settings.openai_api_key,
                model=model or settings.openai_model,
                temperature=settings.llm_temperature,
                max_tokens=settings.llm_max_tokens,
                timeout=settings.llm_timeout,
                max_retries=settings.openai_max_retries,
            )
        elif provider == "anthropic":
            import os
            adapter = adapter_cls(
                api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
                temperature=settings.llm_temperature,
                max_tokens=settings.llm_max_tokens,
            )
        elif provider == "bedrock":
            adapter = adapter_cls(
                region=settings.aws_region or "ap-northeast-1",
                temperature=settings.llm_temperature,
                max_tokens=settings.llm_max_tokens,
            )
        else:
            raise ValueError(f"Provider '{provider}' is registered but has no factory logic.")

        model = adapter.get_model(**overrides)
        logger.info("LLM model created", extra={"provider": provider, "model": getattr(model, "model_name", provider)})
        return model
