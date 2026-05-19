import asyncio
from dataclasses import dataclass
from uuid import UUID

import structlog

from backend.agents_config_loader import get_agents_config
from backend.orchestrator.orchestrator import Orchestrator, PipelineResult
from backend.schemas.comparison_schema import ComparisonOutput
from backend.schemas.input_schema import StockInput

log = structlog.get_logger()


@dataclass
class VariantRunResult:
    variant_id: str
    run_id: UUID
    pipeline_result: PipelineResult


@dataclass
class VariantRunnerResult:
    session_id: UUID
    process_id: str
    variant_results: list[VariantRunResult]
    # Non-None only when multiple active variants ran successfully
    comparison: ComparisonOutput | None


class VariantRunner:
    """
    Fires one full Orchestrator pipeline per active model variant,
    all concurrently.  When multiple variants complete, triggers the
    Comparison component to produce a cross-model diff.

    The caller (FastAPI route) is responsible for creating Session / Run
    database records before calling run() and for persisting results
    afterward.  VariantRunner is pure compute with no DB dependency.
    """

    async def run(
        self,
        stocks: list[StockInput],
        session_id: UUID,
        process_id: str,
        variant_run_ids: dict[str, UUID],  # {variant_id: run_id}
    ) -> VariantRunnerResult:
        """
        variant_run_ids maps each active variant to its pre-created run_id.
        """
        cfg = get_agents_config()

        log.info(
            "variant_runner_start",
            session_id=str(session_id),
            variants=list(variant_run_ids.keys()),
            total_stocks=len(stocks),
        )

        # ── Run all variants concurrently ──────────────────────────────────────
        tasks = {
            variant_id: asyncio.create_task(
                self._run_variant(stocks, run_id, variant_id),
                name=f"variant_{variant_id}",
            )
            for variant_id, run_id in variant_run_ids.items()
        }

        variant_results: list[VariantRunResult] = []
        for variant_id, task in tasks.items():
            try:
                result = await task
                variant_results.append(result)
                log.info(
                    "variant_complete",
                    variant=variant_id,
                    stocks_ranked=len(result.pipeline_result.ceo_output.stocks),
                )
            except Exception as exc:
                log.error(
                    "variant_failed",
                    variant=variant_id,
                    error=str(exc),
                )

        # ── Comparison (multi-variant only) ────────────────────────────────────
        comparison: ComparisonOutput | None = None
        if len(variant_results) > 1 and cfg.should_compare():
            try:
                comparison = await self._compare(
                    variant_results, session_id, process_id
                )
            except Exception as exc:
                log.error("comparison_failed", session_id=str(session_id), error=str(exc))

        log.info(
            "variant_runner_complete",
            session_id=str(session_id),
            variants_succeeded=len(variant_results),
            variants_total=len(variant_run_ids),
            comparison_done=comparison is not None,
        )

        return VariantRunnerResult(
            session_id=session_id,
            process_id=process_id,
            variant_results=variant_results,
            comparison=comparison,
        )

    async def _run_variant(
        self,
        stocks: list[StockInput],
        run_id: UUID,
        variant_id: str,
    ) -> VariantRunResult:
        orchestrator = Orchestrator()
        pipeline_result = await orchestrator.run(
            stocks=stocks,
            run_id=run_id,
            override_variant_id=variant_id,
        )
        return VariantRunResult(
            variant_id=variant_id,
            run_id=run_id,
            pipeline_result=pipeline_result,
        )

    async def _compare(
        self,
        variant_results: list[VariantRunResult],
        session_id: UUID,
        process_id: str,
    ) -> ComparisonOutput:
        # Lazy import — Comparator is written in Phase 14
        from backend.compare.comparator import Comparator  # noqa: PLC0415

        ceo_outputs = {
            vr.variant_id: vr.pipeline_result.ceo_output
            for vr in variant_results
        }
        return Comparator().compare(ceo_outputs, session_id, process_id)
