import asyncio
import json
import uuid
from datetime import datetime, timezone

import orjson
import structlog
import yaml
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.dependencies import get_db
from backend.agents_config_loader import get_agents_config
from backend.database.connection import AsyncSessionLocal
from backend.database.models import (
    AgentResult as AgentResultORM,
    Batch as BatchORM,
    ComparisonResult as ComparisonResultORM,
    FinalResult as FinalResultORM,
    Run as RunORM,
    Session as SessionORM,
)
from backend.database.redis_client import get_run_progress, get_run_status, publish_run_event, subscribe_run_events
from backend.orchestrator.variant_runner import VariantRunner, VariantRunResult, VariantRunnerResult
from backend.schemas.comparison_schema import ComparisonOutput
from backend.schemas.input_schema import InputFile
from backend.schemas.result_schema import (
    RunProgressResponse,
    RunStatusResponse,
    RunSummaryResponse,
    SessionStatusResponse,
)

log = structlog.get_logger()

router = APIRouter(prefix="/api/v1", tags=["run"])


# ── POST /api/v1/run ──────────────────────────────────────────────────────────

@router.post("/run")
async def start_run(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    chunk_size: int = Form(5),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a JSON or YAML stock file, validate it, and start the pipeline.
    Returns session_id immediately; poll /run/{run_id}/status for progress.
    """
    content = await file.read()
    filename = file.filename or "upload"

    try:
        raw = (
            yaml.safe_load(content)
            if filename.lower().endswith((".yaml", ".yml"))
            else json.loads(content)
        )
        input_file = InputFile.model_validate(raw)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid input file: {exc}") from exc

    cfg = get_agents_config()
    active_variants = cfg.pipeline.active_variants

    session_id = uuid.uuid4()
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    stem = filename.rsplit(".", 1)[0][:60]
    process_id = f"{stem}_{ts}"

    # Create Session record
    session_orm = SessionORM(
        session_id=session_id,
        process_id=process_id,
        input_file_name=filename,
        total_stocks=len(input_file.stocks),
        active_variants=active_variants,
        status="running",
    )
    db.add(session_orm)

    # Create one Run record per active variant
    variant_run_ids: dict[str, uuid.UUID] = {}
    for variant_id in active_variants:
        run_id = uuid.uuid4()
        run_orm = RunORM(
            run_id=run_id,
            session_id=session_id,
            model_variant_id=variant_id,
            status="pending",
            total_stocks=len(input_file.stocks),
        )
        db.add(run_orm)
        variant_run_ids[variant_id] = run_id

    await db.commit()

    background_tasks.add_task(
        _pipeline_task,
        stocks=input_file.stocks,
        session_id=session_id,
        process_id=process_id,
        variant_run_ids=variant_run_ids,
        chunk_size=chunk_size,
    )

    log.info(
        "run_started",
        session_id=str(session_id),
        process_id=process_id,
        variants=active_variants,
        total_stocks=len(input_file.stocks),
    )

    return {
        "session_id": str(session_id),
        "process_id": process_id,
        "run_ids": {v: str(r) for v, r in variant_run_ids.items()},
        "total_stocks": len(input_file.stocks),
        "active_variants": active_variants,
        "status": "running",
    }


# ── GET /api/v1/run/{run_id}/status ───────────────────────────────────────────

@router.get("/run/{run_id}/status", response_model=RunStatusResponse)
async def get_run_status_endpoint(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(RunORM, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    progress_data = await get_run_progress(str(run_id))
    progress = RunProgressResponse(**progress_data) if progress_data else None

    return RunStatusResponse(
        run_id=run.run_id,
        session_id=run.session_id,
        model_variant_id=run.model_variant_id,
        status=run.status,
        progress=progress,
        error_message=run.error_message,
    )


# ── GET /api/v1/runs (paginated history) ──────────────────────────────────────

@router.get("/runs", response_model=list[RunSummaryResponse])
async def list_runs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    offset = (page - 1) * page_size
    result = await db.execute(
        select(RunORM)
        .order_by(RunORM.started_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    runs = result.scalars().all()
    sessions = {}
    for run in runs:
        if run.session_id not in sessions:
            sessions[run.session_id] = await db.get(SessionORM, run.session_id)

    out = []
    for run in runs:
        sess = sessions.get(run.session_id)
        duration = None
        if run.completed_at and run.started_at:
            duration = (run.completed_at - run.started_at).total_seconds()
        out.append(
            RunSummaryResponse(
                session_id=run.session_id,
                run_id=run.run_id,
                process_id=sess.process_id if sess else "",
                model_variant_id=run.model_variant_id,
                status=run.status,
                total_stocks=run.total_stocks,
                started_at=run.started_at.isoformat(),
                completed_at=run.completed_at.isoformat() if run.completed_at else None,
                duration_seconds=duration,
            )
        )
    return out


# ── SSE stream ────────────────────────────────────────────────────────────────

_TERMINAL = frozenset({"complete", "failed", "cancelled"})
_HEARTBEAT_SECS = 15.0


async def _sse_generator(run_id: uuid.UUID):
    run_id_str = str(run_id)

    async with AsyncSessionLocal() as snap_db:
        run = await snap_db.get(RunORM, run_id)
    if run is None:
        yield 'event: error\ndata: {"detail":"run not found"}\n\n'
        return

    progress = await get_run_progress(run_id_str)
    yield (
        "data: "
        + orjson.dumps(
            {"type": "snapshot", "status": run.status, "progress": progress, "error_message": run.error_message}
        ).decode()
        + "\n\n"
    )

    if run.status in _TERMINAL:
        return

    pubsub = await subscribe_run_events(run_id_str)
    try:
        last_hb = asyncio.get_event_loop().time()

        if pubsub is not None:
            while True:
                now = asyncio.get_event_loop().time()
                if now - last_hb >= _HEARTBEAT_SECS:
                    yield ": heartbeat\n\n"
                    last_hb = now

                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=0)
                if msg is not None:
                    raw: str = msg["data"]
                    yield f"data: {raw}\n\n"
                    payload = orjson.loads(raw)
                    if payload.get("stage") in _TERMINAL or payload.get("status") in _TERMINAL:
                        return
                await asyncio.sleep(0.1)

        else:
            while True:
                await asyncio.sleep(3.0)
                now = asyncio.get_event_loop().time()
                if now - last_hb >= _HEARTBEAT_SECS:
                    yield ": heartbeat\n\n"
                    last_hb = now

                async with AsyncSessionLocal() as poll_db:
                    fresh = await poll_db.get(RunORM, run_id)
                progress = await get_run_progress(run_id_str)
                if fresh is None:
                    return

                yield (
                    "data: "
                    + orjson.dumps(
                        {"type": "snapshot", "status": fresh.status, "progress": progress, "error_message": fresh.error_message}
                    ).decode()
                    + "\n\n"
                )
                if fresh.status in _TERMINAL:
                    return

    finally:
        if pubsub is not None:
            try:
                await pubsub.unsubscribe(f"run:{run_id_str}:events")
                await pubsub.aclose()
            except Exception:
                pass


@router.get("/run/{run_id}/stream")
async def stream_run_status(run_id: uuid.UUID):
    """SSE stream for run progress. Falls back to DB polling when Redis is absent."""
    return StreamingResponse(
        _sse_generator(run_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ── POST /api/v1/run/{run_id}/cancel ─────────────────────────────────────────

@router.post("/run/{run_id}/cancel", status_code=200)
async def cancel_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Mark a pending/running run as cancelled and publish SSE event to close streams."""
    run = await db.get(RunORM, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status in _TERMINAL:
        raise HTTPException(status_code=409, detail=f"Run already terminal: {run.status}")

    await db.execute(
        RunORM.__table__.update()
        .where(RunORM.run_id == run_id)
        .where(RunORM.status.notin_(_TERMINAL))
        .values(status="cancelled", completed_at=datetime.now(timezone.utc))
    )
    await db.commit()

    await publish_run_event(
        str(run_id),
        {"type": "progress", "stage": "cancelled", "status": "cancelled"},
    )
    log.info("run_cancelled", run_id=str(run_id))
    return {"status": "cancelled", "run_id": str(run_id)}


# ── DELETE /api/v1/run/{run_id} ───────────────────────────────────────────────

@router.delete("/run/{run_id}", status_code=200)
async def delete_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Hard-delete a run and all its cascaded data (batches, agent_results, final_results)."""
    run = await db.get(RunORM, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    await db.delete(run)
    await db.commit()
    log.info("run_deleted", run_id=str(run_id))
    return {"status": "deleted", "run_id": str(run_id)}


# ── Background task ───────────────────────────────────────────────────────────

async def _pipeline_task(
    stocks,
    session_id: uuid.UUID,
    process_id: str,
    variant_run_ids: dict[str, uuid.UUID],
    chunk_size: int = 5,
):
    # Immediately mark all runs as "running" so SSE DB-polling sees a live status.
    async with AsyncSessionLocal() as db:
        for run_id in variant_run_ids.values():
            await db.execute(
                RunORM.__table__.update()
                .where(RunORM.run_id == run_id)
                .values(status="running")
            )
        await db.commit()

    try:
        runner = VariantRunner()
        result = await asyncio.wait_for(
            runner.run(
                stocks=stocks,
                session_id=session_id,
                process_id=process_id,
                variant_run_ids=variant_run_ids,
                chunk_size=chunk_size,
            ),
            timeout=900.0,  # 15-minute hard ceiling — catches any provider hang that escapes agent-level timeouts
        )
        async with AsyncSessionLocal() as db:
            await _persist_results(db, session_id, result, variant_run_ids)
            await db.commit()
        log.info("pipeline_task_complete", session_id=str(session_id))
    except Exception as exc:
        log.error("pipeline_task_failed", session_id=str(session_id), error=str(exc))
        async with AsyncSessionLocal() as db:
            await db.execute(
                SessionORM.__table__.update()
                .where(SessionORM.session_id == session_id)
                .values(status="failed")
            )
            for run_id in variant_run_ids.values():
                await db.execute(
                    RunORM.__table__.update()
                    .where(RunORM.run_id == run_id)
                    .where(RunORM.status != "cancelled")
                    .values(
                        status="failed",
                        error_message=str(exc)[:500],
                        completed_at=datetime.now(timezone.utc),
                    )
                )
            await db.commit()
        for run_id in variant_run_ids.values():
            await publish_run_event(
                str(run_id),
                {"type": "progress", "stage": "failed", "status": "failed"},
            )


async def _persist_results(
    db: AsyncSession,
    session_id: uuid.UUID,
    result: VariantRunnerResult,
    variant_run_ids: dict[str, uuid.UUID],
) -> None:
    now = datetime.now(timezone.utc)
    succeeded_run_ids = {vr.run_id for vr in result.variant_results}

    for vr in result.variant_results:
        await _persist_variant(db, session_id, vr, now)

    # Any variant that was not persisted (failed inside VariantRunner) must be
    # marked failed so the SSE DB-polling fallback exits its loop.
    for run_id in variant_run_ids.values():
        if run_id not in succeeded_run_ids:
            await db.execute(
                RunORM.__table__.update()
                .where(RunORM.run_id == run_id)
                .where(RunORM.status.notin_(_TERMINAL))
                .values(status="failed", completed_at=now)
            )
            await publish_run_event(
                str(run_id),
                {"type": "progress", "stage": "failed", "status": "failed"},
            )

    if result.comparison:
        await _persist_comparison(db, session_id, result.comparison, now)

    await db.execute(
        SessionORM.__table__.update()
        .where(SessionORM.session_id == session_id)
        .values(status="complete", completed_at=now)
    )


async def _persist_variant(
    db: AsyncSession,
    session_id: uuid.UUID,
    vr: VariantRunResult,
    now: datetime,
) -> None:
    pipeline = vr.pipeline_result

    # Determine provider/model from first non-empty agent result
    provider_used = model_used = None
    for chunk in pipeline.chunk_results:
        for br in chunk.agent_results.values():
            if br.provider_used and br.provider_used != "none":
                provider_used = br.provider_used
                model_used = br.model_used
                break
        if provider_used:
            break

    await db.execute(
        RunORM.__table__.update()
        .where(RunORM.run_id == vr.run_id)
        .where(RunORM.status != "cancelled")
        .values(
            status="complete",
            provider_used=provider_used,
            model_used=model_used,
            chunk_count=len(pipeline.chunk_results),
            completed_at=now,
        )
    )

    # Batches + AgentResults
    for idx, chunk in enumerate(pipeline.chunk_results):
        tickers = _tickers_from_chunk(chunk)
        db.add(
            BatchORM(
                batch_id=chunk.batch_id,
                run_id=vr.run_id,
                session_id=session_id,
                batch_index=idx,
                stocks_in_batch=tickers,
                status="complete",
                completed_at=now,
            )
        )
        for agent_name, br in chunk.agent_results.items():
            for ticker, output in br.parsed_output.items():
                db.add(
                    AgentResultORM(
                        batch_id=chunk.batch_id,
                        run_id=vr.run_id,
                        session_id=session_id,
                        agent_name=agent_name,
                        ticker=ticker,
                        provider_used=br.provider_used,
                        model_used=br.model_used,
                        was_fallback=br.was_fallback,
                        web_search_used=br.web_search_used,
                        raw_prompt=br.raw_prompt[:8000] if br.raw_prompt else None,
                        raw_response=br.raw_response[:8000] if br.raw_response else None,
                        parsed_output=output,
                        tokens_used=br.tokens_used,
                        latency_ms=br.latency_ms,
                    )
                )

    # FinalResults
    for item in pipeline.ceo_output.stocks:
        db.add(
            FinalResultORM(
                run_id=vr.run_id,
                session_id=session_id,
                ticker=item.ticker,
                final_score=float(item.final_score),
                rank=item.rank,
                recommendation=item.recommendation,
                confidence=float(item.confidence),
                technical_score=float(item.technical_score) if item.technical_score is not None else None,
                fundamental_score=float(item.fundamental_score) if item.fundamental_score is not None else None,
                sentiment_score=float(item.sentiment_score) if item.sentiment_score is not None else None,
                risk_score=float(item.risk_score) if item.risk_score is not None else None,
                macro_score=float(item.macro_score) if item.macro_score is not None else None,
                override_applied=item.override_applied,
                override_reason=item.override_reason,
                conflicting_signals=item.conflicting_signals or [],
                key_signals=item.key_signals.model_dump() if item.key_signals else None,
                ceo_rationale=item.ceo_rationale,
            )
        )


async def _persist_comparison(
    db: AsyncSession,
    session_id: uuid.UUID,
    comparison: ComparisonOutput,
    now: datetime,
) -> None:
    for item in comparison.stocks:
        db.add(
            ComparisonResultORM(
                session_id=session_id,
                ticker=item.ticker,
                variant_results={
                    vid: snap.model_dump()
                    for vid, snap in item.variant_results.items()
                },
                recommendation_agreement=item.recommendation_agreement,
                max_rank_diff=item.max_rank_diff,
                max_score_diff=float(item.max_score_diff),
                consensus_recommendation=item.consensus_recommendation,
            )
        )


def _tickers_from_chunk(chunk) -> list[str]:
    tickers: set[str] = set()
    for br in chunk.agent_results.values():
        tickers.update(br.parsed_output.keys())
    return sorted(tickers)
