import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.dependencies import get_db
from backend.database.models import AgentResult as AgentResultORM, Run as RunORM

router = APIRouter(prefix="/api/v1", tags=["audit"])


class AuditEntry(BaseModel):
    result_id: str
    run_id: str
    session_id: str
    model_variant_id: str
    agent_name: str
    ticker: str
    provider_used: str | None
    model_used: str | None
    was_fallback: bool
    web_search_used: bool
    tokens_used: int | None
    latency_ms: int | None
    raw_prompt: str | None
    raw_response: str | None
    parsed_output: dict[str, Any] | None
    created_at: str


class AuditResponse(BaseModel):
    total: int
    entries: list[AuditEntry]


@router.get("/audit", response_model=AuditResponse)
async def get_audit_log(
    run_id: str | None = Query(None),
    agent_name: str | None = Query(None),
    ticker: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    filters = []

    if run_id:
        try:
            filters.append(AgentResultORM.run_id == uuid.UUID(run_id))
        except ValueError:
            pass

    if agent_name:
        filters.append(AgentResultORM.agent_name == agent_name)

    if ticker:
        filters.append(AgentResultORM.ticker.ilike(f"%{ticker}%"))

    if status == "ok":
        filters.append(AgentResultORM.parsed_output.isnot(None))
        filters.append(AgentResultORM.was_fallback == False)  # noqa: E712
    elif status == "fallback":
        filters.append(AgentResultORM.was_fallback == True)  # noqa: E712
    elif status == "error":
        filters.append(AgentResultORM.parsed_output.is_(None))

    count_stmt = select(func.count()).select_from(AgentResultORM)
    if filters:
        count_stmt = count_stmt.where(*filters)
    total = (await db.execute(count_stmt)).scalar_one()

    stmt = (
        select(AgentResultORM, RunORM.model_variant_id)
        .join(RunORM, AgentResultORM.run_id == RunORM.run_id)
        .order_by(AgentResultORM.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if filters:
        stmt = stmt.where(*filters)

    rows = (await db.execute(stmt)).all()

    entries = [
        AuditEntry(
            result_id=str(ar.result_id),
            run_id=str(ar.run_id),
            session_id=str(ar.session_id),
            model_variant_id=model_variant_id,
            agent_name=ar.agent_name,
            ticker=ar.ticker,
            provider_used=ar.provider_used,
            model_used=ar.model_used,
            was_fallback=ar.was_fallback,
            web_search_used=ar.web_search_used,
            tokens_used=ar.tokens_used,
            latency_ms=ar.latency_ms,
            raw_prompt=ar.raw_prompt,
            raw_response=ar.raw_response,
            parsed_output=ar.parsed_output,
            created_at=ar.created_at.isoformat(),
        )
        for ar, model_variant_id in rows
    ]

    return AuditResponse(total=total, entries=entries)
