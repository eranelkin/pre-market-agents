from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from dataclasses import replace
from typing import Optional

from backend.schemas.agent_schema import LLMResponse


# ── Common exceptions raised by all providers ─────────────────────────────────

class ProviderRateLimitError(Exception):
    """Provider returned 429 / quota exceeded. LLMClient will trigger fallback."""


class ProviderAPIError(Exception):
    """Non-rate-limit API error. Includes status code and message."""


# ── Tool executor type ────────────────────────────────────────────────────────

# Async callable: (tool_name, arguments_dict) → plain-text result
ToolExecutor = Callable[[str, dict], Awaitable[str]]


# ── Abstract base ─────────────────────────────────────────────────────────────

class BaseProvider(ABC):
    """
    Contract every provider must implement.

    Messages always arrive in OpenAI format:
        [{"role": "system"|"user"|"assistant", "content": "..."}]

    Tool definitions arrive as OpenAI-format tool schemas (list[dict]).
    Each provider converts them to its own API format internally.

    When tool_executor is provided AND the model returns tool calls, the provider
    runs a tool-use loop (up to MAX_TOOL_ITERATIONS rounds) internally before
    returning the final text response.  Providers that do not support tool use
    ignore both the tools parameter and tool_executor.
    """

    MAX_TOOL_ITERATIONS = 3

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Matches the key in agents_config.yaml providers section."""

    @property
    def supports_tool_use(self) -> bool:
        return False

    @property
    def supports_built_in_search(self) -> bool:
        return False

    @abstractmethod
    async def complete(
        self,
        model: str,
        messages: list[dict],
        max_tokens: int,
        tools: list[dict] | None = None,
        enable_built_in_search: bool = False,
        tool_executor: Optional[ToolExecutor] = None,
    ) -> LLMResponse:
        """
        Make one LLM API call (with optional internal tool-use loop) and return
        a normalized LLMResponse.  Always sets was_fallback=False — LLMClient
        flips it on fallback calls.

        Raises ProviderRateLimitError on 429.
        Raises ProviderAPIError on other unrecoverable API errors.
        """


def mark_as_fallback(response: LLMResponse) -> LLMResponse:
    """Returns a copy of response with was_fallback=True. Called by LLMClient."""
    return replace(response, was_fallback=True)
