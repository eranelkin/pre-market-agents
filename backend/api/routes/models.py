import time

from fastapi import APIRouter, HTTPException

from backend.agents_config_loader import (
    add_variant,
    get_agents_config,
    reload_agents_config,
    remove_variant,
    set_variant_active,
)
from backend.agents_config_loader import ModelVariant
from backend.providers.registry import get_provider_registry
from backend.schemas.models_schema import (
    AddVariantRequest,
    ModelPreset,
    TestConnectionResponse,
    ToggleActiveRequest,
    VariantDetail,
)
from backend.utils.env_manager import key_is_set, write_env_var
from backend.utils.prompt_manager import reload_prompts

router = APIRouter(prefix="/api/v1", tags=["models"])

# ── Curated preset catalog ─────────────────────────────────────────────────────

_PRESETS: list[ModelPreset] = [
    ModelPreset(id="llama_3_3_70b", label="LLaMA 3.3 70B (Groq)", provider="groq",
                model="llama-3.3-70b-versatile", max_tokens=4096, tier="free",
                description="Best quality free model. Very fast inference via Groq."),
    ModelPreset(id="llama_3_1_8b", label="LLaMA 3.1 8B Instant (Groq)", provider="groq",
                model="llama-3.1-8b-instant", max_tokens=4096, tier="free",
                description="Lowest latency free model. Good for quick smoke tests."),
    ModelPreset(id="mixtral_8x7b", label="Mixtral 8x7B (Groq)", provider="groq",
                model="mixtral-8x7b-32768", max_tokens=4096, tier="free",
                description="MoE architecture. Strong reasoning and 32k context window."),
    ModelPreset(id="gemini_2_flash", label="Gemini 2.0 Flash (Google)", provider="google",
                model="gemini-2.0-flash-exp", max_tokens=4096, tier="free",
                description="Latest Gemini, free experimental tier. Native grounding built in."),
    ModelPreset(id="gemini_1_5_flash_8b", label="Gemini 1.5 Flash 8B (Google)", provider="google",
                model="gemini-1.5-flash-8b", max_tokens=4096, tier="free",
                description="Smallest and fastest Gemini. Ideal for high-volume testing."),
    ModelPreset(id="claude_haiku", label="Claude Haiku 4.5 (Anthropic)", provider="anthropic",
                model="claude-haiku-4-5-20251001", max_tokens=4096, tier="cheap",
                description="Cheapest Claude — ~25× cheaper than Sonnet. Best for bulk test runs."),
    ModelPreset(id="gpt4o_mini", label="GPT-4o Mini (OpenAI)", provider="openai",
                model="gpt-4o-mini", max_tokens=4096, tier="cheap",
                description="Cheapest OpenAI model with solid general-purpose performance."),
]


# ── Helpers ────────────────────────────────────────────────────────────────────

def _build_variant_detail(cfg, v) -> VariantDetail:
    provider_cfg = cfg.providers.get(v.provider)
    has_key = key_is_set(provider_cfg.api_key_env) if provider_cfg else False
    return VariantDetail(
        id=v.id,
        label=v.label,
        provider=v.provider,
        model=v.model,
        max_tokens=v.max_tokens,
        base_url=provider_cfg.base_url if provider_cfg else None,
        status="ready" if has_key else "no_key",
        active=v.id in cfg.pipeline.active_variants,
    )


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/models")
async def get_models():
    """Return all configured model variants with live status (key present or not)."""
    cfg = get_agents_config()
    variants = [_build_variant_detail(cfg, v) for v in cfg.model_variants]
    return {
        "variants": [d.model_dump() for d in variants],
        "providers": {name: p.model_dump() for name, p in cfg.providers.items()},
        "pipeline": cfg.pipeline.model_dump(),
        "active_variants": cfg.pipeline.active_variants,
    }


@router.get("/models/presets")
async def get_model_presets():
    """Return the curated catalog of free and cheap models available to add."""
    cfg = get_agents_config()
    existing_ids = {v.id for v in cfg.model_variants}
    return [p.model_dump() | {"already_added": p.id in existing_ids} for p in _PRESETS]


@router.post("/models/variants", status_code=201)
async def add_model_variant(body: AddVariantRequest):
    """Add a new model variant to agents_config.yaml. Optionally writes API key to .env."""
    cfg = get_agents_config()
    if body.provider not in cfg.providers:
        raise HTTPException(422, f"Unknown provider '{body.provider}'. Known: {list(cfg.providers)}")

    if body.api_key:
        provider_cfg = cfg.providers[body.provider]
        write_env_var(provider_cfg.api_key_env, body.api_key)

    try:
        new_cfg = add_variant(ModelVariant(
            id=body.id, label=body.label,
            provider=body.provider, model=body.model,
            max_tokens=body.max_tokens,
        ))
    except ValueError as exc:
        raise HTTPException(409, str(exc))

    if body.set_active:
        new_cfg = set_variant_active(body.id, True)

    get_provider_registry().initialize()

    return {
        "status": "created",
        "variant_id": body.id,
        "active_variants": new_cfg.pipeline.active_variants,
    }


@router.delete("/models/variants/{variant_id}")
async def delete_model_variant(variant_id: str):
    """Remove a model variant from agents_config.yaml."""
    try:
        new_cfg = remove_variant(variant_id)
    except KeyError:
        raise HTTPException(404, f"Variant '{variant_id}' not found")
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"status": "deleted", "active_variants": new_cfg.pipeline.active_variants}


@router.patch("/models/variants/{variant_id}/active")
async def toggle_variant_active(variant_id: str, body: ToggleActiveRequest):
    """Toggle a variant's presence in pipeline.active_variants."""
    try:
        new_cfg = set_variant_active(variant_id, body.active)
    except (KeyError, ValueError) as exc:
        raise HTTPException(400, str(exc))
    return {"status": "updated", "active_variants": new_cfg.pipeline.active_variants}


@router.post("/models/variants/{variant_id}/test")
async def test_model_variant(variant_id: str):
    """Send a minimal request to the model to verify the connection and key."""
    cfg = get_agents_config()
    try:
        variant = cfg.get_variant(variant_id)
    except KeyError:
        raise HTTPException(404, f"Variant '{variant_id}' not found")

    registry = get_provider_registry()
    if not registry.is_registered(variant.provider):
        return TestConnectionResponse(
            status="error",
            message="Provider not registered — API key missing or invalid.",
        )

    provider = registry.get(variant.provider)
    t0 = time.monotonic()
    try:
        resp = await provider.complete(
            model=variant.model,
            messages=[{"role": "user", "content": "Reply with the single word OK."}],
            max_tokens=10,
        )
        latency = int((time.monotonic() - t0) * 1000)
        return TestConnectionResponse(status="ok", latency_ms=latency, message=resp.content[:80])
    except Exception as exc:
        return TestConnectionResponse(status="error", message=str(exc)[:300])


@router.post("/models/reload")
async def reload_models():
    """Hot-reload agents_config.yaml from disk without restarting the server."""
    cfg = reload_agents_config()
    return {
        "status": "reloaded",
        "active_variants": cfg.pipeline.active_variants,
        "model_variants": [v.id for v in cfg.model_variants],
    }


@router.post("/prompts/reload")
async def reload_prompt_files():
    """Hot-reload all prompt files from disk without restarting the server."""
    results = reload_prompts()
    all_ok = all(results.values())
    return {
        "status": "ok" if all_ok else "partial",
        "agents": results,
    }
