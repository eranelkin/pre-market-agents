import re
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.agents_config_loader import (
    AgentConfig,
    add_agent,
    get_agents_config,
    get_config,
    get_loader,
    remove_agent,
    set_agent_active,
)
from backend.utils.prompt_manager import reload_prompts

router = APIRouter(prefix="/api/v1", tags=["prompts"])

# backend/api/routes/ → 4 parents up → project root
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent

_SLUG_RE = re.compile(r"^[a-z][a-z0-9_]*$")


class PromptUpdateRequest(BaseModel):
    content: str


class PromptActiveRequest(BaseModel):
    active: bool


class PromptCreateRequest(BaseModel):
    agent_name: str = Field(..., pattern=r"^[a-z][a-z0-9_]*$")
    weight: float = Field(..., gt=0, le=1)
    content: str
    default_variant: str | None = None


class ChildPromptCreateRequest(BaseModel):
    agent_name: str = Field(..., pattern=r"^[a-z][a-z0-9_]*$")
    child_weight: float | None = Field(None, gt=0)
    content: str


def _read_prompt_file(prompt_file: str) -> tuple[str, str | None]:
    """Read file content and ISO last_modified. Returns (content, last_modified)."""
    path = _PROJECT_ROOT / prompt_file
    try:
        content = path.read_text(encoding="utf-8")
        last_modified = datetime.fromtimestamp(
            path.stat().st_mtime, tz=timezone.utc
        ).isoformat()
    except FileNotFoundError:
        content = ""
        last_modified = None
    return content, last_modified


def _read_prompt(name: str, agent: AgentConfig) -> dict:
    content, last_modified = _read_prompt_file(agent.prompt_file)
    return {
        "agent_name": name,
        "file_path": agent.prompt_file,
        "content": content,
        "last_modified": last_modified,
        "char_count": len(content),
        "is_system": agent.is_system,
        "active": agent.active,
        "weight": agent.weight,
        "children": [],  # populated by list_prompts for top-level agents
    }


def _read_child_prompt(name: str, agent: AgentConfig) -> dict:
    content, last_modified = _read_prompt_file(agent.prompt_file)
    return {
        "agent_name": name,
        "file_path": agent.prompt_file,
        "content": content,
        "last_modified": last_modified,
        "char_count": len(content),
        "active": agent.active,
        "child_weight": agent.child_weight,
    }


@router.get("/prompts")
async def list_prompts(test_mode: bool = Query(False)):
    """Return top-level agent prompts with children embedded. Child agents are not in the top list."""
    cfg = get_config(test_mode)
    result = []
    for name, agent in cfg.agents.items():
        if agent.parent is not None:
            continue  # children are nested under their parent, not in the top-level list
        info = _read_prompt(name, agent)
        info["children"] = [
            _read_child_prompt(cn, cc) for cn, cc in cfg.get_children(name)
        ]
        result.append(info)
    return result


@router.post("/prompts", status_code=201)
async def create_prompt(body: PromptCreateRequest, test_mode: bool = Query(False)):
    """Create a new custom agent: write the .md file and add an entry to agents_config.yaml."""
    loader = get_loader(test_mode)
    cfg = get_config(test_mode)

    if body.agent_name in cfg.agents:
        raise HTTPException(409, f"Agent '{body.agent_name}' already exists")

    variant_id = body.default_variant or (
        cfg.pipeline.active_variants[0] if cfg.pipeline.active_variants else None
    )
    if not variant_id or not any(v.id == variant_id for v in cfg.model_variants):
        raise HTTPException(422, f"Variant '{variant_id}' not found in model_variants")

    prompt_file = f"prompts/test/{body.agent_name}_prompt.md" if test_mode else f"prompts/{body.agent_name}_prompt.md"
    path = _PROJECT_ROOT / prompt_file
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body.content, encoding="utf-8")
    except Exception as exc:
        raise HTTPException(500, f"Failed to write prompt file: {exc}")

    try:
        loader.add_agent(
            body.agent_name,
            AgentConfig(
                weight=body.weight,
                prompt_file=prompt_file,
                default_variant=variant_id,
            ),
        )
    except Exception as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(500, f"Failed to update config: {exc}")

    reload_prompts()
    return {"status": "created", "agent_name": body.agent_name, "prompt_file": prompt_file}


@router.post("/prompts/{parent_name}/children", status_code=201)
async def create_child_prompt(parent_name: str, body: ChildPromptCreateRequest, test_mode: bool = Query(False)):
    """Create a child sub-agent under an existing custom agent."""
    loader = get_loader(test_mode)
    cfg = get_config(test_mode)

    if parent_name not in cfg.agents:
        raise HTTPException(404, f"Agent '{parent_name}' not found")
    parent = cfg.agents[parent_name]
    if parent.is_system:
        raise HTTPException(400, f"Cannot add children to system agent '{parent_name}'")
    if parent.parent is not None:
        raise HTTPException(400, f"Agent '{parent_name}' is itself a child — only one level of nesting is supported")
    if body.agent_name in cfg.agents:
        raise HTTPException(409, f"Agent '{body.agent_name}' already exists")

    prompt_file = f"prompts/test/{body.agent_name}_prompt.md" if test_mode else f"prompts/{body.agent_name}_prompt.md"
    path = _PROJECT_ROOT / prompt_file
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body.content, encoding="utf-8")
    except Exception as exc:
        raise HTTPException(500, f"Failed to write prompt file: {exc}")

    try:
        loader.add_agent(
            body.agent_name,
            AgentConfig(
                weight=0.0,
                child_weight=body.child_weight,
                parent=parent_name,
                prompt_file=prompt_file,
                default_variant=parent.default_variant,
                fallback_variant=parent.fallback_variant,
            ),
        )
    except Exception as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(500, f"Failed to update config: {exc}")

    reload_prompts()
    return {"status": "created", "agent_name": body.agent_name, "parent": parent_name, "prompt_file": prompt_file}


# ── Routes with {agent_name} parameter ───────────────────────────────────────
# The /active sub-path must be registered before the bare /{agent_name} PATCH
# so FastAPI doesn't confuse "active" for an agent name on PATCH requests.

@router.patch("/prompts/{agent_name}/active")
async def toggle_prompt_active(agent_name: str, body: PromptActiveRequest, test_mode: bool = Query(False)):
    """Enable or disable an analysis agent in the pipeline."""
    cfg = get_config(test_mode)
    if agent_name not in cfg.agents:
        raise HTTPException(404, f"Agent '{agent_name}' not found")
    if cfg.agents[agent_name].is_system:
        raise HTTPException(400, f"System agent '{agent_name}' cannot be toggled")
    try:
        get_loader(test_mode).set_agent_active(agent_name, body.active)
    except (KeyError, ValueError) as exc:
        raise HTTPException(400, str(exc))
    return {"status": "updated", "agent_name": agent_name, "active": body.active}


@router.get("/prompts/{agent_name}")
async def get_prompt(agent_name: str, test_mode: bool = Query(False)):
    """Return a single agent's prompt content."""
    cfg = get_config(test_mode)
    if agent_name not in cfg.agents:
        raise HTTPException(404, f"Agent '{agent_name}' not found")
    return _read_prompt(agent_name, cfg.agents[agent_name])


@router.patch("/prompts/{agent_name}")
async def update_prompt(agent_name: str, body: PromptUpdateRequest, test_mode: bool = Query(False)):
    """Write new content to the agent's prompt file and hot-reload."""
    cfg = get_config(test_mode)
    if agent_name not in cfg.agents:
        raise HTTPException(404, f"Agent '{agent_name}' not found")

    path = _PROJECT_ROOT / cfg.agents[agent_name].prompt_file
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body.content, encoding="utf-8")
    except Exception as exc:
        raise HTTPException(500, f"Failed to write prompt file: {exc}")

    reload_prompts()
    return {"status": "saved", "agent_name": agent_name, "char_count": len(body.content)}


@router.delete("/prompts/{agent_name}")
async def delete_prompt(agent_name: str, test_mode: bool = Query(False)):
    """Delete a custom agent and cascade-delete its children if it has any."""
    loader = get_loader(test_mode)
    cfg = get_config(test_mode)
    if agent_name not in cfg.agents:
        raise HTTPException(404, f"Agent '{agent_name}' not found")
    if cfg.agents[agent_name].is_system:
        raise HTTPException(400, f"Cannot delete system agent '{agent_name}'")

    # Cascade: remove children first (children have no children, so no recursion needed)
    children = cfg.get_children(agent_name)
    deleted_children = []
    for child_name, child_cfg in children:
        loader.remove_agent(child_name)
        (_PROJECT_ROOT / child_cfg.prompt_file).unlink(missing_ok=True)
        deleted_children.append(child_name)

    prompt_file = cfg.agents[agent_name].prompt_file
    loader.remove_agent(agent_name)
    (_PROJECT_ROOT / prompt_file).unlink(missing_ok=True)

    reload_prompts()
    return {"status": "deleted", "agent_name": agent_name, "children_deleted": deleted_children}
