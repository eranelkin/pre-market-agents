import asyncio
import json
import re
from typing import Any
from uuid import UUID

import structlog
import yaml

from backend.agents_config_loader import AgentConfig, get_agents_config
from backend.schemas.agent_schema import (
    AgentBatchResult,
    get_agent_output_model,
)
from backend.schemas.input_schema import StockInput
from backend.tools.base_tool import BaseTool
from backend.utils.llm_client import build_llm_client_for_agent
from backend.utils.prompt_manager import get_prompt_manager

log = structlog.get_logger()

# ── YAML repair helpers ────────────────────────────────────────────────────────

_FENCE_RE = re.compile(r"```(?:yaml|yml)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)
_LIST_START_RE = re.compile(r"(?:^|\n)(\s*-\s+ticker:.*)", re.DOTALL)


def _strip_fence(text: str) -> str:
    m = _FENCE_RE.search(text)
    return m.group(1) if m else text


def _try_yaml_load(text: str) -> list[dict] | None:
    try:
        data = yaml.safe_load(text)
        if isinstance(data, list):
            return data
    except yaml.YAMLError:
        pass
    return None


def _parse_yaml_with_repair(content: str, agent_name: str) -> list[dict]:
    """
    Three-pass YAML extraction:
    1. Parse raw content as-is.
    2. Strip markdown code fences and try again.
    3. Find the first "- ticker:" line and parse from there.
    Returns an empty list if all strategies fail (caller handles gracefully).
    """
    for attempt, text in enumerate([
        content,
        _strip_fence(content),
        (m.group(1) if (m := _LIST_START_RE.search(content)) else None),
    ]):
        if text is None:
            continue
        result = _try_yaml_load(text)
        if result is not None:
            if attempt > 0:
                log.debug("yaml_repaired", agent=agent_name, strategy=attempt)
            return result

    log.error(
        "yaml_parse_failed",
        agent=agent_name,
        content_preview=content[:300],
    )
    return []


# ── Base Agent ─────────────────────────────────────────────────────────────────

class BaseAgent:
    """
    Fully functional base class for all five analysis agents.

    Subclasses only need to declare `agent_name` as a class attribute.
    The heavy lifting — prompt loading, LLM calling, tool injection,
    YAML parsing, Pydantic validation — all lives here.

    `run()` never raises: any unhandled exception or timeout returns an
    `AgentBatchResult.empty()` so the chunk pipeline continues.
    """

    agent_name: str  # set by each subclass

    def __init__(self, override_variant_id: str | None = None) -> None:
        self._override_variant_id = override_variant_id

    # ── Public API ─────────────────────────────────────────────────────────────

    async def run(
        self,
        stocks: list[StockInput],
        run_id: UUID,
        batch_id: UUID,
    ) -> AgentBatchResult:
        """
        Run this agent over a batch of stocks.
        Always returns an AgentBatchResult; on failure returns the empty sentinel.
        """
        agent_cfg = get_agents_config().get_agent(self.agent_name)
        try:
            return await asyncio.wait_for(
                self._run_inner(stocks, run_id, batch_id, agent_cfg),
                timeout=float(agent_cfg.timeout_seconds),
            )
        except asyncio.TimeoutError:
            log.error(
                "agent_timeout",
                agent=self.agent_name,
                timeout_s=agent_cfg.timeout_seconds,
                batch_id=str(batch_id),
            )
            return AgentBatchResult.empty(self.agent_name, batch_id, run_id)
        except Exception as exc:
            log.error(
                "agent_failed",
                agent=self.agent_name,
                error=str(exc),
                batch_id=str(batch_id),
            )
            return AgentBatchResult.empty(self.agent_name, batch_id, run_id)

    async def run_with_children_context(
        self,
        stocks: list[StockInput],
        run_id: UUID,
        batch_id: UUID,
        children_context: str,
    ) -> AgentBatchResult:
        """Run this agent as a judge: same as run() but injects children results into the user message."""
        agent_cfg = get_agents_config().get_agent(self.agent_name)
        try:
            return await asyncio.wait_for(
                self._run_inner(stocks, run_id, batch_id, agent_cfg, children_context),
                timeout=float(agent_cfg.timeout_seconds),
            )
        except asyncio.TimeoutError:
            log.error(
                "agent_timeout",
                agent=self.agent_name,
                timeout_s=agent_cfg.timeout_seconds,
                batch_id=str(batch_id),
            )
            return AgentBatchResult.empty(self.agent_name, batch_id, run_id)
        except Exception as exc:
            log.error(
                "agent_failed",
                agent=self.agent_name,
                error=str(exc),
                batch_id=str(batch_id),
            )
            return AgentBatchResult.empty(self.agent_name, batch_id, run_id)

    # ── Internal pipeline ──────────────────────────────────────────────────────

    async def _run_inner(
        self,
        stocks: list[StockInput],
        run_id: UUID,
        batch_id: UUID,
        agent_cfg: AgentConfig,
        children_context: str | None = None,
    ) -> AgentBatchResult:
        tools = self._build_tools(agent_cfg)
        system_prompt = get_prompt_manager().get(self.agent_name)
        messages = self._build_messages(system_prompt, stocks, children_context)

        client, primary, fallback = build_llm_client_for_agent(
            self.agent_name, self._override_variant_id
        )

        llm_resp = await client.call(
            messages=messages,
            variant=primary,
            max_tokens=agent_cfg.max_tokens,
            agent_name=self.agent_name,
            fallback_variant=fallback,
            tools=tools if tools else None,
            enable_built_in_search=agent_cfg.enable_web_search,
        )

        parsed = self._parse_and_validate(llm_resp.content, stocks)

        log.info(
            "agent_complete",
            agent=self.agent_name,
            batch_id=str(batch_id),
            tickers_returned=list(parsed.keys()),
            tickers_expected=[s.ticker for s in stocks],
            was_fallback=llm_resp.was_fallback,
            web_search_used=llm_resp.web_search_used,
            tokens=llm_resp.tokens_used,
            latency_ms=llm_resp.latency_ms,
        )

        return AgentBatchResult(
            agent_name=self.agent_name,
            batch_id=batch_id,
            run_id=run_id,
            provider_used=llm_resp.provider_used,
            model_used=llm_resp.model_used,
            was_fallback=llm_resp.was_fallback,
            web_search_used=llm_resp.web_search_used,
            raw_prompt=system_prompt,
            raw_response=llm_resp.content,
            parsed_output=parsed,
            tokens_used=llm_resp.tokens_used,
            latency_ms=llm_resp.latency_ms,
        )

    # ── Tool injection ─────────────────────────────────────────────────────────

    def _build_tools(self, agent_cfg: AgentConfig) -> list[BaseTool]:
        tools: list[BaseTool] = []
        if agent_cfg.enable_web_search:
            from backend.tools.web_search_tool import get_web_search_tool
            tool = get_web_search_tool()
            if tool:
                tools.append(tool)
        if agent_cfg.enable_deep_search:
            from backend.tools.deep_search_tool import get_deep_search_tool
            tool = get_deep_search_tool()
            if tool:
                tools.append(tool)
        return tools

    # ── Message building ───────────────────────────────────────────────────────

    def _build_messages(
        self,
        system_prompt: str,
        stocks: list[StockInput],
        children_context: str | None = None,
    ) -> list[dict]:
        stock_data = json.dumps(
            [s.model_dump() for s in stocks], indent=2, default=str
        )
        user_content = (
            f"Analyze the following {len(stocks)} stock(s) "
            f"and return the required YAML output:\n\n```json\n{stock_data}\n```"
        )
        if children_context:
            user_content += f"\n\n{children_context}"
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]

    # ── YAML parse + validate ──────────────────────────────────────────────────

    def _parse_and_validate(
        self, content: str, stocks: list[StockInput]
    ) -> dict[str, Any]:
        """
        Parse the LLM's YAML response and validate each entry against the
        agent's Pydantic output model.  Returns {ticker: validated_dict}.
        Skips individual entries that fail validation (logs a warning).
        """
        output_model = get_agent_output_model(self.agent_name)
        raw_list = _parse_yaml_with_repair(content, self.agent_name)

        expected = {s.ticker for s in stocks}
        result: dict[str, Any] = {}

        for item in raw_list:
            if not isinstance(item, dict):
                continue
            ticker = str(item.get("ticker", "")).strip().upper()
            if not ticker:
                log.warning("agent_output_missing_ticker", agent=self.agent_name, item=item)
                continue
            try:
                validated = output_model.model_validate(item)
                result[ticker] = validated.model_dump()
            except Exception as exc:
                log.warning(
                    "agent_output_validation_failed",
                    agent=self.agent_name,
                    ticker=ticker,
                    error=str(exc),
                )

        missing = expected - set(result.keys())
        if missing:
            log.warning(
                "agent_output_missing_tickers",
                agent=self.agent_name,
                missing=sorted(missing),
            )

        return result
