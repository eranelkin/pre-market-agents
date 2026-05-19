import csv
import io
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.dependencies import get_db
from backend.database.models import (
    AgentResult as AgentResultORM,
    FinalResult as FinalResultORM,
    Run as RunORM,
    Session as SessionORM,
)
from backend.schemas.result_schema import (
    AgentBreakdownResponse,
    FinalResultItem,
    RunResultsResponse,
    Top3Pick,
    RedFlag,
)

router = APIRouter(prefix="/api/v1", tags=["results"])

_CSV_FIELDS = [
    "rank", "ticker", "recommendation", "final_score", "confidence",
    "technical_score", "fundamental_score", "sentiment_score",
    "risk_score", "macro_score", "override_applied", "override_reason",
]


@router.get("/run/{run_id}/results", response_model=RunResultsResponse)
async def get_results(run_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    run = await db.get(RunORM, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status not in ("complete",):
        raise HTTPException(
            status_code=202,
            detail=f"Run is not complete yet (status: {run.status})",
        )

    rows = (
        await db.execute(
            select(FinalResultORM)
            .where(FinalResultORM.run_id == run_id)
            .order_by(FinalResultORM.rank)
        )
    ).scalars().all()

    results = [_orm_to_final_item(r) for r in rows]
    top_3 = [
        Top3Pick(ticker=r.ticker, rank=r.rank, entry_rationale=r.ceo_rationale or "")
        for r in results[:3]
    ]
    red_flags = [
        RedFlag(ticker=r.ticker, reason=r.override_reason or f"Score {r.final_score:.1f}")
        for r in results
        if r.final_score < 30 or r.override_applied
    ]

    return RunResultsResponse(
        run_id=run.run_id,
        session_id=run.session_id,
        model_variant_id=run.model_variant_id,
        provider_used=run.provider_used,
        model_used=run.model_used,
        total_stocks=run.total_stocks,
        results=results,
        top_3_picks=top_3,
        red_flags=red_flags,
    )


@router.get("/run/{run_id}/results/export")
async def export_results_csv(run_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    run = await db.get(RunORM, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    rows = (
        await db.execute(
            select(FinalResultORM)
            .where(FinalResultORM.run_id == run_id)
            .order_by(FinalResultORM.rank)
        )
    ).scalars().all()

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=_CSV_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({
            "rank": row.rank,
            "ticker": row.ticker,
            "recommendation": row.recommendation,
            "final_score": row.final_score,
            "confidence": row.confidence,
            "technical_score": row.technical_score,
            "fundamental_score": row.fundamental_score,
            "sentiment_score": row.sentiment_score,
            "risk_score": row.risk_score,
            "macro_score": row.macro_score,
            "override_applied": row.override_applied,
            "override_reason": row.override_reason or "",
        })

    buf.seek(0)
    filename = f"results_{run_id}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/run/{run_id}/agents/{ticker}", response_model=AgentBreakdownResponse)
async def get_agent_breakdown(
    run_id: uuid.UUID,
    ticker: str,
    db: AsyncSession = Depends(get_db),
):
    ticker = ticker.upper()
    agent_rows = (
        await db.execute(
            select(AgentResultORM).where(
                AgentResultORM.run_id == run_id,
                AgentResultORM.ticker == ticker,
            )
        )
    ).scalars().all()

    if not agent_rows:
        raise HTTPException(status_code=404, detail=f"No agent results for {ticker} in run {run_id}")

    agents: dict[str, Any] = {}
    for row in agent_rows:
        agents[row.agent_name] = {
            **(row.parsed_output or {}),
            "provider_used": row.provider_used,
            "model_used": row.model_used,
            "was_fallback": row.was_fallback,
            "web_search_used": row.web_search_used,
            "tokens_used": row.tokens_used,
            "latency_ms": row.latency_ms,
        }

    return AgentBreakdownResponse(ticker=ticker, run_id=run_id, agents=agents)


def _orm_to_final_item(row: FinalResultORM) -> FinalResultItem:
    return FinalResultItem(
        ticker=row.ticker,
        final_score=float(row.final_score or 0),
        rank=row.rank or 0,
        recommendation=row.recommendation or "HOLD",
        confidence=float(row.confidence or 0),
        technical_score=float(row.technical_score) if row.technical_score is not None else None,
        fundamental_score=float(row.fundamental_score) if row.fundamental_score is not None else None,
        sentiment_score=float(row.sentiment_score) if row.sentiment_score is not None else None,
        risk_score=float(row.risk_score) if row.risk_score is not None else None,
        macro_score=float(row.macro_score) if row.macro_score is not None else None,
        override_applied=row.override_applied,
        override_reason=row.override_reason,
        conflicting_signals=row.conflicting_signals or [],
        ceo_rationale=row.ceo_rationale,
    )
