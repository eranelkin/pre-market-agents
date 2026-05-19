import json
import time
from typing import Optional

from backend.providers.base_provider import (
    BaseProvider, ProviderAPIError, ProviderRateLimitError, ToolExecutor,
)
from backend.schemas.agent_schema import LLMResponse


class OpenAIProvider(BaseProvider):
    provider_name = "openai"

    @property
    def supports_tool_use(self) -> bool:
        return True

    @property
    def supports_built_in_search(self) -> bool:
        return False

    def __init__(self, api_key: str) -> None:
        from openai import AsyncOpenAI
        self._client = AsyncOpenAI(api_key=api_key)

    async def complete(
        self,
        model: str,
        messages: list[dict],
        max_tokens: int,
        tools: list[dict] | None = None,
        enable_built_in_search: bool = False,
        tool_executor: Optional[ToolExecutor] = None,
    ) -> LLMResponse:
        from openai import RateLimitError, APIStatusError

        conversation = list(messages)
        kwargs: dict = {
            "model": model,
            "max_tokens": max_tokens,
        }
        if tools:
            kwargs["tools"] = tools  # already in OpenAI format

        t0 = time.monotonic()
        total_tokens = 0
        web_search_used = False
        resp = None

        for iteration in range(self.MAX_TOOL_ITERATIONS + 1):
            kwargs["messages"] = conversation
            try:
                resp = await self._client.chat.completions.create(**kwargs)
            except RateLimitError as e:
                raise ProviderRateLimitError(str(e)) from e
            except APIStatusError as e:
                raise ProviderAPIError(f"OpenAI {e.status_code}: {e.message}") from e

            total_tokens += resp.usage.total_tokens if resp.usage else 0
            message = resp.choices[0].message
            tool_calls = message.tool_calls or []

            if not tool_calls or tool_executor is None or iteration == self.MAX_TOOL_ITERATIONS:
                break

            # Append assistant turn with tool calls
            conversation.append({
                "role": "assistant",
                "content": message.content,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in tool_calls
                ],
            })

            # Execute each tool and append results
            for tc in tool_calls:
                try:
                    args = json.loads(tc.function.arguments)
                    result = await tool_executor(tc.function.name, args)
                except Exception as exc:
                    result = f"Tool '{tc.function.name}' failed: {exc}"
                conversation.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                })
                web_search_used = True

        content = resp.choices[0].message.content or ""
        return LLMResponse(
            content=content,
            provider_used="openai",
            model_used=model,
            was_fallback=False,
            web_search_used=web_search_used,
            tokens_used=total_tokens,
            latency_ms=int((time.monotonic() - t0) * 1000),
        )
