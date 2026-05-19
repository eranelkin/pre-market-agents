import time
from typing import Optional

from backend.providers.base_provider import BaseProvider, ProviderAPIError, ProviderRateLimitError, ToolExecutor
from backend.schemas.agent_schema import LLMResponse


def _to_google_messages(messages: list[dict]) -> tuple[str | None, list[dict]]:
    """
    Splits OpenAI-format messages into (system_instruction, google_history).
    Google roles: "user" stays "user", "assistant" becomes "model".
    System messages are extracted as a separate system_instruction string.
    """
    system_parts: list[str] = []
    history: list[dict] = []

    for msg in messages:
        role = msg["role"]
        content = msg["content"]
        if role == "system":
            system_parts.append(content)
        elif role == "assistant":
            history.append({"role": "model", "parts": [content]})
        else:
            history.append({"role": "user", "parts": [content]})

    system_instruction = "\n\n".join(system_parts) if system_parts else None
    return system_instruction, history


class GoogleProvider(BaseProvider):
    provider_name = "google"

    @property
    def supports_tool_use(self) -> bool:
        return True

    @property
    def supports_built_in_search(self) -> bool:
        return True

    def __init__(self, api_key: str) -> None:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        self._genai = genai

    async def complete(
        self,
        model: str,
        messages: list[dict],
        max_tokens: int,
        tools: list[dict] | None = None,
        enable_built_in_search: bool = False,
        tool_executor: Optional[ToolExecutor] = None,  # not used — Google uses grounding
    ) -> LLMResponse:
        system_instruction, history = _to_google_messages(messages)

        model_kwargs: dict = {}
        if system_instruction:
            model_kwargs["system_instruction"] = system_instruction

        genai_model = self._genai.GenerativeModel(
            model_name=model, **model_kwargs
        )

        generation_config = self._genai.GenerationConfig(
            max_output_tokens=max_tokens,
        )

        call_tools = []
        if enable_built_in_search:
            call_tools.append({"google_search_retrieval": {}})

        t0 = time.monotonic()
        try:
            resp = await genai_model.generate_content_async(
                contents=history,
                generation_config=generation_config,
                tools=call_tools if call_tools else None,
            )
        except Exception as e:
            # Google SDK exception hierarchy varies by version — check by name
            exc_name = type(e).__name__
            module = type(e).__module__ or ""
            if "ResourceExhausted" in exc_name or "quota" in str(e).lower():
                raise ProviderRateLimitError(str(e)) from e
            if "google" in module or "GoogleAPI" in exc_name:
                raise ProviderAPIError(f"Google API error: {e}") from e
            raise

        try:
            content = resp.text
        except ValueError:
            # Model was blocked or returned no usable text
            content = ""

        tokens = 0
        if hasattr(resp, "usage_metadata") and resp.usage_metadata:
            tokens = getattr(resp.usage_metadata, "total_token_count", 0) or 0

        web_search_used = enable_built_in_search and bool(content)

        return LLMResponse(
            content=content,
            provider_used="google",
            model_used=model,
            was_fallback=False,
            web_search_used=web_search_used,
            tokens_used=tokens,
            latency_ms=int((time.monotonic() - t0) * 1000),
        )
