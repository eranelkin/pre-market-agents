import asyncio
import uuid
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import structlog

from backend.agents.base_agent import BaseAgent
from backend.agents_config_loader import get_agents_config

# Registry of hand-written agent subclasses.  New config-only agents fall back
# to a dynamically-created BaseAgent subclass and need no file here.
def _build_subclass_map() -> dict[str, type[BaseAgent]]:
    registry: dict[str, type[BaseAgent]] = {}
    try:
        from backend.agents.technical_agent import TechnicalAgent
        registry["technical"] = TechnicalAgent
    except ImportError:
        pass
    try:
        from backend.agents.fundamental_agent import FundamentalAgent
        registry["fundamental"] = FundamentalAgent
    except ImportError:
        pass
    try:
        from backend.agents.sentiment_agent import SentimentAgent
        registry["sentiment"] = SentimentAgent
    except ImportError:
        pass
    try:
        from backend.agents.risk_agent import RiskAgent
        registry["risk"] = RiskAgent
    except ImportError:
        pass
    try:
        from backend.agents.macro_agent import MacroAgent
        registry["macro"] = MacroAgent
    except ImportError:
        pass
    return registry

_SUBCLASS_MAP: dict[str, type[BaseAgent]] = _build_subclass_map()


def _make_agent(name: str, variant_id: str | None) -> BaseAgent:
    cls = _SUBCLASS_MAP.get(
        name,
        type(f"{name.title()}Agent", (BaseAgent,), {"agent_name": name}),
    )
    return cls(variant_id)
from backend.database.redis_client import publish_run_event, set_run_progress, set_run_status
from backend.orchestrator import chunker, merger
from backend.schemas.agent_schema import ChunkResult
from backend.schemas.input_schema import StockInput
from backend.schemas.result_schema import CEOOutput

log = structlog.get_logger()


@dataclass
class PipelineResult:
    """Everything the VariantRunner and route layer need after one pipeline run."""
    ceo_output: CEOOutput
    chunk_results: list[ChunkResult]
    # Nested {ticker: {agent_name: output_dict}} — kept for debugging / DB writes
    merged: dict[str, dict[str, Any]]


async def _set_progress(
    run_id: UUID,
    chunks_done: int,
    total_chunks: int,
    total_stocks: int,
    stage: str,
) -> None:
    payload = {
        "total_chunks": total_chunks,
        "chunks_completed": chunks_done,
        "total_stocks": total_stocks,
        "stage": stage,
    }
    await set_run_progress(str(run_id), payload)
    await publish_run_event(str(run_id), {"type": "progress", **payload})


class Orchestrator:
    """
    Two-level parallel pipeline for one model variant:

        Level 1 — chunks run concurrently via asyncio.create_task
        Level 2 — within each chunk the 5 agents run concurrently via asyncio.gather

    Progress is written to Redis after each chunk completes (no-op if Redis is absent).
    Agent failures are isolated: a single agent crashing does not kill its chunk.
    """

    async def run(
        self,
        stocks: list[StockInput],
        run_id: UUID,
        override_variant_id: str,
    ) -> PipelineResult:
        cfg = get_agents_config()
        chunk_size = cfg.pipeline.chunk_size
        chunks = chunker.split(stocks, chunk_size)
        total_chunks = len(chunks)

        log.info(
            "orchestrator_start",
            run_id=str(run_id),
            variant=override_variant_id,
            total_stocks=len(stocks),
            total_chunks=total_chunks,
            chunk_size=chunk_size,
        )
        await set_run_status(str(run_id), "agents_running")
        await _set_progress(run_id, 0, total_chunks, len(stocks), "agents_running")

        # ── Level 1: all chunks in parallel ───────────────────────────────────
        batch_ids = [uuid.uuid4() for _ in chunks]
        tasks = [
            asyncio.create_task(
                self._run_chunk(chunk, run_id, batch_id, override_variant_id)
            )
            for chunk, batch_id in zip(chunks, batch_ids)
        ]

        chunk_results: list[ChunkResult] = []
        chunks_done = 0
        for fut in asyncio.as_completed(tasks):
            result = await fut
            chunk_results.append(result)
            chunks_done += 1
            await _set_progress(run_id, chunks_done, total_chunks, len(stocks), "agents_running")
            log.debug(
                "orchestrator_chunk_done",
                run_id=str(run_id),
                chunks_done=chunks_done,
                total_chunks=total_chunks,
            )

        # ── Merge ──────────────────────────────────────────────────────────────
        merged = merger.merge(chunk_results)
        ceo_input = merger.format_for_ceo(merged)

        # ── CEO evaluation ─────────────────────────────────────────────────────
        await set_run_status(str(run_id), "ceo_evaluating")
        await _set_progress(run_id, total_chunks, total_chunks, len(stocks), "ceo_evaluating")

        # Lazy import — CEO is written in Phase 13
        from backend.ceo.chief_evaluator import ChiefEvaluator  # noqa: PLC0415

        evaluator = ChiefEvaluator(override_variant_id=override_variant_id)
        ceo_output = await evaluator.evaluate(ceo_input, run_id)

        await set_run_status(str(run_id), "complete")
        await _set_progress(run_id, total_chunks, total_chunks, len(stocks), "complete")

        log.info(
            "orchestrator_complete",
            run_id=str(run_id),
            variant=override_variant_id,
            stocks_ranked=len(ceo_output.stocks),
        )
        return PipelineResult(
            ceo_output=ceo_output,
            chunk_results=chunk_results,
            merged=merged,
        )

    async def _run_chunk(
        self,
        chunk: list[StockInput],
        run_id: UUID,
        batch_id: UUID,
        override_variant_id: str,
    ) -> ChunkResult:
        """
        Level 2: run all configured agents (excluding CEO) over this chunk concurrently.
        Agent failures are already isolated inside BaseAgent.run().
        """
        cfg = get_agents_config()
        agents = [
            _make_agent(name, override_variant_id)
            for name in cfg.agents
            if name != "ceo"
        ]

        batch_results = await asyncio.gather(
            *[agent.run(chunk, run_id, batch_id) for agent in agents]
        )

        agent_results = {r.agent_name: r for r in batch_results}
        failed_agents = [
            name for name, r in agent_results.items() if not r.parsed_output
        ]

        if failed_agents:
            log.warning(
                "chunk_agents_failed",
                batch_id=str(batch_id),
                failed=failed_agents,
                tickers=[s.ticker for s in chunk],
            )

        return ChunkResult(
            batch_id=batch_id,
            run_id=run_id,
            agent_results=agent_results,
            failed_agents=failed_agents,
        )
