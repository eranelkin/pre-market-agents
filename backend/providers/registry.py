import structlog

from backend.providers.base_provider import BaseProvider

log = structlog.get_logger()


class ProviderRegistry:
    """
    Holds one live provider instance per configured provider name.
    Initialized at app startup via initialize(). All agents and LLMClient
    call get(provider_name) to retrieve a provider.
    """

    def __init__(self) -> None:
        self._providers: dict[str, BaseProvider] = {}

    def initialize(self) -> None:
        """
        Instantiate every provider that has both a config entry and an API key.
        Called once from FastAPI lifespan. Safe to call again (re-registers).
        """
        from backend.config import settings
        from backend.agents_config_loader import get_agents_config
        from backend.providers.anthropic_provider import AnthropicProvider
        from backend.providers.openai_provider import OpenAIProvider
        from backend.providers.google_provider import GoogleProvider
        from backend.providers.groq_provider import GroqProvider

        cfg = get_agents_config()

        candidates: list[tuple[str, type[BaseProvider], str | None]] = [
            ("anthropic", AnthropicProvider, settings.anthropic_api_key),
            ("openai",    OpenAIProvider,    settings.openai_api_key),
            ("google",    GoogleProvider,    settings.google_api_key),
            ("groq",      GroqProvider,      settings.groq_api_key),
        ]

        self._providers.clear()

        for name, cls, api_key in candidates:
            if name not in cfg.providers:
                continue
            if not api_key:
                log.warning("provider_skipped_no_api_key", provider=name,
                            hint=f"Set {cfg.providers[name].api_key_env} in .env")
                continue
            try:
                self._providers[name] = cls(api_key=api_key)
                log.info("provider_registered", provider=name, model_class=cls.__name__)
            except Exception as e:
                log.error("provider_init_failed", provider=name, error=str(e))

    def get(self, provider_name: str) -> BaseProvider:
        if provider_name not in self._providers:
            available = list(self._providers.keys())
            raise RuntimeError(
                f"Provider '{provider_name}' is not registered "
                f"(available: {available}). "
                f"Check that the API key env var is set in .env."
            )
        return self._providers[provider_name]

    def available(self) -> list[str]:
        return list(self._providers.keys())

    def is_registered(self, provider_name: str) -> bool:
        return provider_name in self._providers


# Module-level singleton
_registry = ProviderRegistry()


def get_provider_registry() -> ProviderRegistry:
    return _registry
