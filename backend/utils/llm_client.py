import structlog

from backend.agents_config_loader import ModelVariant, get_agents_config
from backend.providers.base_provider import (
    ProviderAPIError, ProviderRateLimitError, ToolExecutor, mark_as_fallback,
)
from backend.providers.registry import get_provider_registry
from backend.schemas.agent_schema import LLMResponse
from backend.tools.base_tool import BaseTool

log = structlog.get_logger()


def _make_executor(tools: list[BaseTool]) -> ToolExecutor:
    """Build an async tool executor from a list of BaseTool instances."""
    tool_map = {t.name: t for t in tools}

    async def executor(name: str, arguments: dict) -> str:
        tool = tool_map.get(name)
        if tool is None:
            return f"Error: unknown tool '{name}'. Available: {list(tool_map)}"
        try:
            return await tool.execute(**arguments)
        except Exception as exc:
            return f"Tool '{name}' failed: {exc}"

    return executor


class LLMClient:
    """
    Single entry point for all LLM calls within the pipeline.

    Responsibilities:
    - Resolves which tools to inject based on provider capabilities
    - Delegates to the ProviderRegistry's provider instance
    - Retries on the fallback variant when the primary raises a provider error
    - Logs every call attempt at DEBUG level

    The tool-use loop (if tools are provided) runs inside each provider — this
    client only needs to build the executor and pass it down.
    """

    async def call(
        self,
        messages: list[dict],
        variant: ModelVariant,
        max_tokens: int,
        agent_name: str = "unknown",
        fallback_variant: ModelVariant | None = None,
        tools: list[BaseTool] | None = None,
        enable_built_in_search: bool = False,
    ) -> LLMResponse:
        """
        Make an LLM call using the given variant.
        Falls back to fallback_variant on ProviderRateLimitError or ProviderAPIError.
        """
        try:
            return await self._attempt(
                messages=messages,
                variant=variant,
                max_tokens=max_tokens,
                agent_name=agent_name,
                tools=tools,
                enable_built_in_search=enable_built_in_search,
                is_fallback=False,
            )
        except (ProviderRateLimitError, ProviderAPIError) as primary_err:
            if fallback_variant is None:
                log.error(
                    "llm_call_failed_no_fallback",
                    agent=agent_name,
                    variant=variant.id,
                    error=str(primary_err),
                )
                raise

            log.warning(
                "llm_primary_failed_trying_fallback",
                agent=agent_name,
                primary_variant=variant.id,
                fallback_variant=fallback_variant.id,
                error=str(primary_err),
            )
            try:
                resp = await self._attempt(
                    messages=messages,
                    variant=fallback_variant,
                    max_tokens=max_tokens,
                    agent_name=agent_name,
                    tools=tools,
                    enable_built_in_search=enable_built_in_search,
                    is_fallback=True,
                )
                return mark_as_fallback(resp)
            except (ProviderRateLimitError, ProviderAPIError) as fallback_err:
                raise ProviderAPIError(
                    f"Both primary ({variant.id}) and fallback ({fallback_variant.id}) failed. "
                    f"Primary: {primary_err}. Fallback: {fallback_err}"
                ) from fallback_err

    async def _attempt(
        self,
        messages: list[dict],
        variant: ModelVariant,
        max_tokens: int,
        agent_name: str,
        tools: list[BaseTool] | None,
        enable_built_in_search: bool,
        is_fallback: bool,
    ) -> LLMResponse:
        registry = get_provider_registry()

        if not registry.is_registered(variant.provider):
            raise ProviderAPIError(
                f"Provider '{variant.provider}' is not registered "
                f"(variant '{variant.id}'). Check that the API key env var is set."
            )

        provider = registry.get(variant.provider)

        # Decide what to inject based on provider capabilities
        use_built_in = enable_built_in_search and provider.supports_built_in_search
        use_tool_search = bool(tools) and provider.supports_tool_use

        if enable_built_in_search and not use_built_in and not use_tool_search:
            log.warning(
                "web_search_skipped_provider_unsupported",
                agent=agent_name,
                provider=variant.provider,
                variant=variant.id,
            )

        tool_defs = [t.tool_definition for t in tools] if use_tool_search else None
        tool_executor = _make_executor(tools) if use_tool_search else None

        log.debug(
            "llm_attempt",
            agent=agent_name,
            variant=variant.id,
            provider=variant.provider,
            model=variant.model,
            is_fallback=is_fallback,
            tool_names=[t.name for t in tools] if tools else [],
            use_built_in_search=use_built_in,
        )

        return await provider.complete(
            model=variant.model,
            messages=messages,
            max_tokens=max_tokens,
            tools=tool_defs,
            enable_built_in_search=use_built_in,
            tool_executor=tool_executor,
        )


# ── Convenience factory ───────────────────────────────────────────────────────

def build_llm_client_for_agent(agent_name: str, override_variant_id: str | None = None):
    """
    Returns (LLMClient, primary_variant, fallback_variant) for the named agent.
    The caller passes override_variant_id when running a multi-variant pipeline.
    """
    cfg = get_agents_config()
    primary = cfg.resolve_variant_for_agent(agent_name, override_variant_id)
    fallback = cfg.resolve_fallback_variant_for_agent(agent_name)
    return LLMClient(), primary, fallback
