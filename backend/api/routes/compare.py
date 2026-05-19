import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.dependencies import get_db
from backend.database.models import (
    ComparisonResult as ComparisonResultORM,
    Session as SessionORM,
)
from backend.schemas.comparison_schema import (
    ComparisonItem,
    ComparisonOutput,
    VariantResultSnapshot,
)

router = APIRouter(prefix="/api/v1", tags=["compare"])


@router.get("/compare/{session_id}", response_model=ComparisonOutput)
async def get_comparison(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    session = await db.get(SessionORM, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if len(session.active_variants) < 2:
        raise HTTPException(
            status_code=400,
            detail="This session ran only one variant — no comparison available.",
        )

    rows = (
        await db.execute(
            select(ComparisonResultORM)
            .where(ComparisonResultORM.session_id == session_id)
            .order_by(ComparisonResultORM.ticker)
        )
    ).scalars().all()

    if not rows:
        raise HTTPException(
            status_code=202,
            detail="Comparison results not yet available — pipeline may still be running.",
        )

    items = [_orm_to_comparison_item(row) for row in rows]
    return ComparisonOutput.build(session_id, session.process_id, items)


def _orm_to_comparison_item(row: ComparisonResultORM) -> ComparisonItem:
    snapshots = {
        vid: VariantResultSnapshot.model_validate(snap)
        for vid, snap in (row.variant_results or {}).items()
    }
    return ComparisonItem.build(row.ticker, snapshots)
