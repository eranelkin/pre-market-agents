"""
ChildAggregator: runs a parent agent's active children in parallel then either:

  MATH MODE  — parent prompt is empty/blank:
    Weighted average of children numeric outputs (weight=None treated as 1.0).

  JUDGE MODE — parent has a non-empty prompt:
    Children run first, then parent's LLM call receives all children results
    as structured context and synthesizes them into a final verdict.
"""
import asyncio
from typing import Any
from uuid import UUID

import structlog

from backend.agents.base_agent import BaseAgent
from backend.agents_config_loader import AgentConfig
from backend.schemas.agent_schema import AgentBatchResult

log = structlog.get_logger()


# ── Weight helpers ─────────────────────────────────────────────────────────────

def _normalize_weights(raw: list[float | None]) -> list[float]:
    effective = [w if w is not None else 1.0 for w in raw]
    total = sum(effective)
    if total == 0:
        return [1.0 / len(raw)] * len(raw)
    return [w / total for w in effective]


# ── Math-mode aggregation ──────────────────────────────────────────────────────

def _aggregate_ticker_outputs(outputs: list[dict], weights: list[float]) -> dict:
    """Weighted merge of multiple agent outputs for the same ticker."""
    if len(outputs) == 1:
        return dict(outputs[0])

    total_w = sum(weights)
    norm_weights = [w / total_w for w in weights] if total_w > 0 else [1.0 / len(weights)] * len(weights)

    all_keys: set[str] = set()
    for o in outputs:
        all_keys.update(o.keys())

    merged: dict[str, Any] = {}
    for key in all_keys:
        available = [(o[key], w) for o, w in zip(outputs, norm_weights) if key in o]
        if not available:
            continue

        sample_val = available[0][0]

        if isinstance(sample_val, bool):
            score = sum(w for v, w in available if v)
            av_total = sum(w for _, w in available)
            merged[key] = score > av_total / 2
        elif isinstance(sample_val, (int, float)):
            av_total = sum(w for _, w in available)
            merged[key] = sum(v * w for v, w in available) / av_total if av_total > 0 else sample_val
        else:
            merged[key] = max(available, key=lambda x: x[1])[0]

    return merged


# ── ChildAggregator ────────────────────────────────────────────────────────────

class ChildAggregator:
    """
    Runs a set of child BaseAgent instances in parallel then merges results.
    Mode is determined at runtime by whether the parent has a non-empty prompt.
    """

    def __init__(self, parent_name: str, override_variant_id: str | None = None) -> None:
        self.parent_name = parent_name
        self._override_variant_id = override_variant_id

    async def run(
        self,
        child_agents: list[BaseAgent],
        child_cfgs: list[AgentConfig],
        stocks: list,
        run_id: UUID,
        batch_id: UUID,
    ) -> AgentBatchResult:
        weights = _normalize_weights([cfg.child_weight for cfg in child_cfgs])

        raw_results = await asyncio.gather(
            *[agent.run(stocks, run_id, batch_id) for agent in child_agents],
            return_exceptions=True,
        )

        successful: list[tuple[AgentBatchResult, float]] = []
        for i, r in enumerate(raw_results):
            if isinstance(r, BaseException):
                log.error(
                    "child_agent_exception",
                    parent=self.parent_name,
                    child=child_agents[i].agent_name,
                    error=str(r),
                )
            else:
                successful.append((r, weights[i]))

        if not successful:
            log.warning("all_children_failed", parent=self.parent_name)
            return AgentBatchResult.empty(self.parent_name, batch_id, run_id)

        # Choose mode based on parent prompt content
        from backend.utils.prompt_manager import get_prompt_manager
        parent_prompt = get_prompt_manager().get(self.parent_name)

        if parent_prompt.strip():
            log.debug("child_aggregator_judge_mode", parent=self.parent_name)
            result = await self._run_judge(successful, child_agents, stocks, run_id, batch_id)
        else:
            log.debug("child_aggregator_math_mode", parent=self.parent_name)
            result = self._aggregate(successful, batch_id, run_id)
        result.child_results = [r for r, _ in successful]
        return result

    # ── Judge mode ─────────────────────────────────────────────────────────────

    async def _run_judge(
        self,
        successful: list[tuple[AgentBatchResult, float]],
        child_agents: list[BaseAgent],
        stocks: list,
        run_id: UUID,
        batch_id: UUID,
    ) -> AgentBatchResult:
        from backend.orchestrator.orchestrator import _make_agent
        children_context = self._build_children_context(successful, child_agents)
        parent_agent = _make_agent(self.parent_name, self._override_variant_id)
        return await parent_agent.run_with_children_context(
            stocks, run_id, batch_id, children_context
        )

    def _build_children_context(
        self,
        successful: list[tuple[AgentBatchResult, float]],
        child_agents: list[BaseAgent],
    ) -> str:
        all_tickers = sorted({t for r, _ in successful for t in r.parsed_output})

        lines = [
            "=== Sub-Agent Results ===",
            "The following analyses were completed by your sub-agents. "
            "Synthesize them into your final verdict.\n",
        ]

        for ticker in all_tickers:
            lines.append(f"--- {ticker} ---")
            for (result, weight), agent in zip(successful, child_agents):
                if ticker not in result.parsed_output:
                    continue
                lines.append(f"[{agent.agent_name}] (weight: {weight:.2f}):")
                output = result.parsed_output[ticker]
                for k, v in output.items():
                    if k != "ticker":
                        lines.append(f"  {k}: {v}")
                lines.append("")

        return "\n".join(lines)

    # ── Math mode ──────────────────────────────────────────────────────────────

    def _aggregate(
        self,
        successful: list[tuple[AgentBatchResult, float]],
        batch_id: UUID,
        run_id: UUID,
    ) -> AgentBatchResult:
        all_tickers: set[str] = set()
        for result, _ in successful:
            all_tickers.update(result.parsed_output.keys())

        aggregated: dict[str, Any] = {}
        for ticker in all_tickers:
            ticker_outputs = []
            ticker_weights = []
            for result, w in successful:
                if ticker in result.parsed_output:
                    ticker_outputs.append(result.parsed_output[ticker])
                    ticker_weights.append(w)
            if ticker_outputs:
                aggregated[ticker] = _aggregate_ticker_outputs(ticker_outputs, ticker_weights)

        return AgentBatchResult(
            agent_name=self.parent_name,
            batch_id=batch_id,
            run_id=run_id,
            provider_used="aggregated",
            model_used="aggregated",
            was_fallback=False,
            web_search_used=any(r.web_search_used for r, _ in successful),
            raw_prompt="[aggregated from children]",
            raw_response="[aggregated from children]",
            parsed_output=aggregated,
            tokens_used=sum(r.tokens_used for r, _ in successful),
            latency_ms=max(r.latency_ms for r, _ in successful),
        )
