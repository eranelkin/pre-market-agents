import re
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.agents_config_loader import (
    AgentConfig,
    add_agent,
    get_agents_config,
    remove_agent,
)
from backend.utils.prompt_manager import reload_prompts

router = APIRouter(prefix="/api/v1", tags=["prompts"])

# backend/api/routes/ → 4 parents up → project root
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent

# Built-in agents that cannot be deleted via the API
_BUILT_IN_AGENTS = {"technical", "fundamental", "sentiment", "risk", "macro", "ceo"}

_SLUG_RE = re.compile(r"^[a-z][a-z0-9_]*$")


class PromptUpdateRequest(BaseModel):
    content: str


class PromptCreateRequest(BaseModel):
    agent_name: str = Field(..., pattern=r"^[a-z][a-z0-9_]*$")
    weight: float = Field(..., gt=0, le=1)
    content: str
    default_variant: str | None = None  # defaults to first active variant


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
        "is_built_in": name in _BUILT_IN_AGENTS,
    }


@router.get("/prompts")
async def list_prompts():
    """Return all agent prompts with their current file content."""
    cfg = get_agents_config()
    return [_read_prompt(name, agent.prompt_file) for name, agent in cfg.agents.items()]


@router.post("/prompts", status_code=201)
async def create_prompt(body: PromptCreateRequest):
    """Create a new agent: write the .md file and add an entry to agents_config.yaml."""
    cfg = get_agents_config()

    if body.agent_name in cfg.agents:
        raise HTTPException(409, f"Agent '{body.agent_name}' already exists")

    # Resolve default variant
    variant_id = body.default_variant or (
        cfg.pipeline.active_variants[0] if cfg.pipeline.active_variants else None
    )
    if not variant_id or not any(v.id == variant_id for v in cfg.model_variants):
        raise HTTPException(422, f"Variant '{variant_id}' not found in model_variants")

    prompt_file = f"prompts/{body.agent_name}_prompt.md"
    path = _PROJECT_ROOT / prompt_file
    try:
        path.write_text(body.content, encoding="utf-8")
    except Exception as exc:
        raise HTTPException(500, f"Failed to write prompt file: {exc}")

    try:
        add_agent(
            body.agent_name,
            AgentConfig(
                weight=body.weight,
                prompt_file=prompt_file,
                default_variant=variant_id,
            ),
        )
    except Exception as exc:
        path.unlink(missing_ok=True)  # roll back file write
        raise HTTPException(500, f"Failed to update config: {exc}")

    reload_prompts()
    return {"status": "created", "agent_name": body.agent_name, "prompt_file": prompt_file}


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


@router.delete("/prompts/{agent_name}", status_code=200)
async def delete_prompt(agent_name: str):
    """Delete a custom agent: remove from config and delete its .md file."""
    if agent_name in _BUILT_IN_AGENTS:
        raise HTTPException(400, f"Cannot delete built-in agent '{agent_name}'")

    cfg = get_agents_config()
    if agent_name not in cfg.agents:
        raise HTTPException(404, f"Agent '{agent_name}' not found")

    prompt_file = cfg.agents[agent_name].prompt_file
    remove_agent(agent_name)

    path = _PROJECT_ROOT / prompt_file
    path.unlink(missing_ok=True)

    reload_prompts()
    return {"status": "deleted", "agent_name": agent_name}
