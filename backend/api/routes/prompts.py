from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.agents_config_loader import get_agents_config
from backend.utils.prompt_manager import reload_prompts

router = APIRouter(prefix="/api/v1", tags=["prompts"])

# backend/api/routes/ → 4 parents up → project root
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent


class PromptUpdateRequest(BaseModel):
    content: str


def _read_prompt(name: str, prompt_file: str) -> dict:
    path = _PROJECT_ROOT / prompt_file
    try:
        content = path.read_text(encoding="utf-8")
        last_modified = datetime.fromtimestamp(
            path.stat().st_mtime, tz=timezone.utc
        ).isoformat()
    except FileNotFoundError:
        content = ""
        last_modified = None
    return {
        "agent_name": name,
        "file_path": prompt_file,
        "content": content,
        "last_modified": last_modified,
        "char_count": len(content),
    }


@router.get("/prompts")
async def list_prompts():
    """Return all agent prompts with their current file content."""
    cfg = get_agents_config()
    return [_read_prompt(name, agent.prompt_file) for name, agent in cfg.agents.items()]


@router.get("/prompts/{agent_name}")
async def get_prompt(agent_name: str):
    """Return a single agent's prompt content."""
    cfg = get_agents_config()
    if agent_name not in cfg.agents:
        raise HTTPException(404, f"Agent '{agent_name}' not found")
    return _read_prompt(agent_name, cfg.agents[agent_name].prompt_file)


@router.patch("/prompts/{agent_name}")
async def update_prompt(agent_name: str, body: PromptUpdateRequest):
    """Write new content to the agent's prompt file and hot-reload."""
    cfg = get_agents_config()
    if agent_name not in cfg.agents:
        raise HTTPException(404, f"Agent '{agent_name}' not found")

    path = _PROJECT_ROOT / cfg.agents[agent_name].prompt_file
    try:
        path.write_text(body.content, encoding="utf-8")
    except Exception as exc:
        raise HTTPException(500, f"Failed to write prompt file: {exc}")

    reload_prompts()
    return {"status": "saved", "agent_name": agent_name, "char_count": len(body.content)}
