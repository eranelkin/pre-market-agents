import time
from typing import Optional

from backend.providers.base_provider import (
    BaseProvider, ProviderAPIError, ProviderRateLimitError, ToolExecutor,
)
from backend.schemas.agent_schema import LLMResponse


def _openai_to_anthropic_tool(tool_def: dict) -> dict:
    """Convert an OpenAI-format tool schema to the Anthropic tool format."""
    fn = tool_def["function"]
    return {
        "name": fn["name"],
        "description": fn.get("description", ""),
        "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
    }


class AnthropicProvider(BaseProvider):
    provider_name = "anthropic"

    @property
    def supports_tool_use(self) -> bool:
        return True

    @property
    def supports_built_in_search(self) -> bool:
        return False

    def __init__(self, api_key: str) -> None:
        from anthropic import AsyncAnthropic
        self._client = AsyncAnthropic(api_key=api_key)

    async def complete(
        self,
        model: str,
        messages: list[dict],
        max_tokens: int,
        tools: list[dict] | None = None,
        enable_built_in_search: bool = False,
        tool_executor: Optional[ToolExecutor] = None,
    ) -> LLMResponse:
        from anthropic import RateLimitError, APIStatusError

        # Anthropic separates system from the messages list
        system_text: str | None = None
        conversation: list[dict] = []
        for msg in messages:
            if msg["role"] == "system":
                system_text = msg["content"]
            else:
                conversation.append(msg)

        anthropic_tools = (
            [_openai_to_anthropic_tool(t) for t in tools] if tools else None
        )

        kwargs: dict = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": conversation,
        }
        if system_text:
            kwargs["system"] = system_text
        if anthropic_tools:
            kwargs["tools"] = anthropic_tools

        t0 = time.monotonic()
        total_tokens = 0
        web_search_used = False
        resp = None

        for iteration in range(self.MAX_TOOL_ITERATIONS + 1):
            kwargs["messages"] = conversation
            try:
                resp = await self._client.messages.create(**kwargs)
            except RateLimitError as e:
                raise ProviderRateLimitError(str(e)) from e
            except APIStatusError as e:
                raise ProviderAPIError(f"Anthropic {e.status_code}: {e.message}") from e

            total_tokens += resp.usage.input_tokens + resp.usage.output_tokens

            tool_use_blocks = [b for b in resp.content if b.type == "tool_use"]
            if not tool_use_blocks or tool_executor is None or iteration == self.MAX_TOOL_ITERATIONS:
                break

            # Append assistant turn (may mix text + tool_use blocks)
            assistant_content = []
            for block in resp.content:
                if block.type == "text":
                    assistant_content.append({"type": "text", "text": block.text})
                elif block.type == "tool_use":
                    assistant_content.append({
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })
            conversation.append({"role": "assistant", "content": assistant_content})

            # Execute each tool and collect results
            tool_results = []
            for block in tool_use_blocks:
                try:
                    result = await tool_executor(block.name, block.input)
                except Exception as exc:
                    result = f"Tool '{block.name}' failed: {exc}"
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result,
                })
                web_search_used = True

            conversation.append({"role": "user", "content": tool_results})

        text_parts = [b.text for b in resp.content if hasattr(b, "text")]
        content = "\n".join(text_parts)
        return LLMResponse(
            content=content,
            provider_used="anthropic",
            model_used=model,
            was_fallback=False,
            web_search_used=web_search_used,
            tokens_used=total_tokens,
            latency_ms=int((time.monotonic() - t0) * 1000),
        )
