import time
from typing import Optional

from backend.providers.base_provider import BaseProvider, ProviderAPIError, ProviderRateLimitError, ToolExecutor
from backend.schemas.agent_schema import LLMResponse


class GroqProvider(BaseProvider):
    """
    Groq uses an OpenAI-compatible API. Tool use and built-in search are not
    supported — if an agent's provider resolves to Groq and has web search
    enabled, the tools parameter is silently dropped.
    """

    provider_name = "groq"

    @property
    def supports_tool_use(self) -> bool:
        return False

    @property
    def supports_built_in_search(self) -> bool:
        return False

    def __init__(self, api_key: str) -> None:
        from groq import AsyncGroq
        # Explicit HTTP timeout prevents the SDK from hanging indefinitely when
        # Groq is slow or unresponsive (asyncio cancellation alone is unreliable).
        self._client = AsyncGroq(api_key=api_key, timeout=30.0)

    async def complete(
        self,
        model: str,
        messages: list[dict],
        max_tokens: int,
        tools: list[dict] | None = None,
        enable_built_in_search: bool = False,
        tool_executor: Optional[ToolExecutor] = None,  # not used — Groq drops tools
    ) -> LLMResponse:
        from groq import RateLimitError, APIStatusError

        t0 = time.monotonic()
        try:
            resp = await self._client.chat.completions.create(
                model=model,
                max_tokens=max_tokens,
                messages=messages,
                # tools intentionally omitted — Groq does not support tool calling
            )
        except RateLimitError as e:
            raise ProviderRateLimitError(str(e)) from e
        except APIStatusError as e:
            raise ProviderAPIError(f"Groq {e.status_code}: {e.message}") from e

        content = resp.choices[0].message.content or ""
        tokens = resp.usage.total_tokens if resp.usage else 0

        return LLMResponse(
            content=content,
            provider_used="groq",
            model_used=model,
            was_fallback=False,
            web_search_used=False,
            tokens_used=tokens,
            latency_ms=int((time.monotonic() - t0) * 1000),
        )
