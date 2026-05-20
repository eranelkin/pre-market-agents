from fastapi import APIRouter
from pydantic import BaseModel

from backend.agents_config_loader import get_agents_config, set_ceo_autonomous

router = APIRouter(prefix="/api/v1/pipeline", tags=["pipeline"])


class CeoAutonomousRequest(BaseModel):
    enabled: bool


@router.get("/settings")
async def get_pipeline_settings():
    """Return current pipeline settings."""
    cfg = get_agents_config()
    return {
        "ceo_autonomous": cfg.pipeline.ceo_autonomous,
        "chunk_size": cfg.pipeline.chunk_size,
        "compare_when_multiple": cfg.pipeline.compare_when_multiple,
    }


@router.patch("/ceo-autonomous")
async def set_ceo_autonomous_mode(body: CeoAutonomousRequest):
    """Toggle CEO autonomous scoring mode."""
    cfg = set_ceo_autonomous(body.enabled)
    return {"status": "updated", "ceo_autonomous": cfg.pipeline.ceo_autonomous}
