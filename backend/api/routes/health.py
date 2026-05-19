from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.dependencies import get_db
from backend.providers.registry import get_provider_registry
from backend.utils.prompt_manager import get_prompt_manager

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(db: AsyncSession = Depends(get_db)):
    db_ok = False
    try:
        await db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        pass

    registry = get_provider_registry()
    return {
        "status": "ok" if db_ok else "degraded",
        "database": "ok" if db_ok else "error",
        "providers_registered": registry.available(),
        "prompts_loaded": get_prompt_manager().loaded_agents(),
    }
