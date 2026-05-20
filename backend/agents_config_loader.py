import threading
from pathlib import Path
from typing import Optional

import yaml
from pydantic import BaseModel, Field, model_validator

_CONFIG_PATH = Path("agents_config.yaml")


# ── Pydantic models for agents_config.yaml ────────────────────────────────────

class ProviderConfig(BaseModel):
    api_key_env: str
    base_url: Optional[str] = None
    supports_tool_use: bool = False
    supports_built_in_search: bool = False


class ModelVariant(BaseModel):
    id: str
    label: str
    provider: str
    model: str
    max_tokens: int = 4096


class AgentConfig(BaseModel):
    weight: float = 0.0  # CEO scoring weight; 0 = not scored (e.g. the CEO agent itself)
    prompt_file: str
    default_variant: str
    fallback_variant: Optional[str] = None
    max_tokens: int = 2000
    timeout_seconds: int = 45
    enable_web_search: bool = False
    enable_deep_search: bool = False


class PipelineConfig(BaseModel):
    chunk_size: int = Field(5, ge=1)
    active_variants: list[str] = Field(default_factory=list)
    compare_when_multiple: bool = True


class SearchConfig(BaseModel):
    provider: str = "tavily"
    api_key_env: str = "TAVILY_API_KEY"
    max_results: int = Field(5, ge=1)


class AgentsConfig(BaseModel):
    providers: dict[str, ProviderConfig]
    model_variants: list[ModelVariant]
    agents: dict[str, AgentConfig]
    pipeline: PipelineConfig
    search: SearchConfig = Field(default_factory=SearchConfig)

    @model_validator(mode="after")
    def validate_references(self) -> "AgentsConfig":
        variant_ids = {v.id for v in self.model_variants}
        provider_ids = set(self.providers.keys())

        # Unique variant IDs
        ids = [v.id for v in self.model_variants]
        duplicates = {i for i in ids if ids.count(i) > 1}
        if duplicates:
            raise ValueError(f"Duplicate model_variant ids: {sorted(duplicates)}")

        # Each variant must reference a known provider
        for v in self.model_variants:
            if v.provider not in provider_ids:
                raise ValueError(
                    f"model_variant '{v.id}' references unknown provider '{v.provider}'"
                )

        # Each agent must reference known variants
        for name, cfg in self.agents.items():
            if cfg.default_variant not in variant_ids:
                raise ValueError(
                    f"agent '{name}' default_variant '{cfg.default_variant}' not in model_variants"
                )
            if cfg.fallback_variant and cfg.fallback_variant not in variant_ids:
                raise ValueError(
                    f"agent '{name}' fallback_variant '{cfg.fallback_variant}' not in model_variants"
                )

        # Pipeline active_variants must be known
        for vid in self.pipeline.active_variants:
            if vid not in variant_ids:
                raise ValueError(
                    f"pipeline.active_variants entry '{vid}' not in model_variants"
                )

        return self

    # ── Convenience accessors ──────────────────────────────────────────────────

    def get_variant(self, variant_id: str) -> ModelVariant:
        for v in self.model_variants:
            if v.id == variant_id:
                return v
        raise KeyError(f"Model variant not found: '{variant_id}'")

    def get_active_variants(self) -> list[ModelVariant]:
        return [self.get_variant(vid) for vid in self.pipeline.active_variants]

    def get_agent(self, agent_name: str) -> AgentConfig:
        if agent_name not in self.agents:
            raise KeyError(f"Agent not found in config: '{agent_name}'")
        return self.agents[agent_name]

    def resolve_variant_for_agent(
        self, agent_name: str, override_variant_id: Optional[str] = None
    ) -> ModelVariant:
        """
        Returns the ModelVariant an agent should use for a given pipeline run.
        override_variant_id is set by the VariantRunner when running multi-variant mode —
        it replaces the agent's default_variant so all agents use the same model for that run.
        """
        if override_variant_id:
            return self.get_variant(override_variant_id)
        return self.get_variant(self.get_agent(agent_name).default_variant)

    def resolve_fallback_variant_for_agent(self, agent_name: str) -> Optional[ModelVariant]:
        fallback_id = self.get_agent(agent_name).fallback_variant
        return self.get_variant(fallback_id) if fallback_id else None

    def provider_for_variant(self, variant_id: str) -> ProviderConfig:
        variant = self.get_variant(variant_id)
        return self.providers[variant.provider]

    def is_multi_variant(self) -> bool:
        return len(self.pipeline.active_variants) > 1

    def should_compare(self) -> bool:
        return self.is_multi_variant() and self.pipeline.compare_when_multiple


# ── Singleton loader ──────────────────────────────────────────────────────────

class AgentsConfigLoader:
    """
    Loads and validates agents_config.yaml. Thread-safe reload via reload().
    All modules should import the `agents_config` singleton below rather than
    instantiating this class directly.
    """

    def __init__(self, config_path: Path = _CONFIG_PATH) -> None:
        self._path = config_path
        self._config: Optional[AgentsConfig] = None
        self._lock = threading.Lock()

    def load(self) -> AgentsConfig:
        with self._lock:
            raw = yaml.safe_load(self._path.read_text(encoding="utf-8"))
            self._config = AgentsConfig.model_validate(raw)
            return self._config

    def reload(self) -> AgentsConfig:
        """Hot-reload from disk. Called by POST /api/v1/models/reload."""
        return self.load()

    def save(self, cfg: AgentsConfig) -> None:
        """Write cfg back to agents_config.yaml. Comments are stripped on save."""
        raw = {
            "providers": {
                name: p.model_dump()
                for name, p in cfg.providers.items()
            },
            "model_variants": [v.model_dump() for v in cfg.model_variants],
            "agents": {
                name: a.model_dump()
                for name, a in cfg.agents.items()
            },
            "pipeline": cfg.pipeline.model_dump(),
            "search": cfg.search.model_dump(),
        }
        with self._lock:
            self._path.write_text(
                yaml.dump(raw, default_flow_style=False, allow_unicode=True, sort_keys=False),
                encoding="utf-8",
            )
            self._config = AgentsConfig.model_validate(raw)

    def add_variant(self, variant: ModelVariant) -> AgentsConfig:
        with self._lock:
            cfg = self.config
            if any(v.id == variant.id for v in cfg.model_variants):
                raise ValueError(f"Variant id '{variant.id}' already exists")
            updated = cfg.model_copy(
                update={"model_variants": cfg.model_variants + [variant]}
            )
        self.save(updated)
        return updated

    def remove_variant(self, variant_id: str) -> AgentsConfig:
        with self._lock:
            cfg = self.config
            remaining = [v for v in cfg.model_variants if v.id != variant_id]
            if len(remaining) == len(cfg.model_variants):
                raise KeyError(f"Variant '{variant_id}' not found")
            active = [v for v in cfg.pipeline.active_variants if v != variant_id]
            if not active:
                raise ValueError("Cannot delete the last active variant")
            updated = cfg.model_copy(update={
                "model_variants": remaining,
                "pipeline": cfg.pipeline.model_copy(update={"active_variants": active}),
            })
        self.save(updated)
        return updated

    def add_agent(self, name: str, agent_cfg: AgentConfig) -> AgentsConfig:
        with self._lock:
            cfg = self.config
            if name in cfg.agents:
                raise ValueError(f"Agent '{name}' already exists")
            updated_agents = dict(cfg.agents) | {name: agent_cfg}
            updated = cfg.model_copy(update={"agents": updated_agents})
        self.save(updated)
        return updated

    def remove_agent(self, name: str) -> AgentsConfig:
        with self._lock:
            cfg = self.config
            if name not in cfg.agents:
                raise KeyError(f"Agent '{name}' not found")
            updated_agents = {k: v for k, v in cfg.agents.items() if k != name}
            updated = cfg.model_copy(update={"agents": updated_agents})
        self.save(updated)
        return updated

    def set_variant_active(self, variant_id: str, active: bool) -> AgentsConfig:
        with self._lock:
            cfg = self.config
            if not any(v.id == variant_id for v in cfg.model_variants):
                raise KeyError(f"Variant '{variant_id}' not found")
            current = list(cfg.pipeline.active_variants)
            if active and variant_id not in current:
                current.append(variant_id)
            elif not active and variant_id in current:
                if len(current) == 1:
                    raise ValueError("Cannot deactivate the last active variant")
                current.remove(variant_id)
            updated = cfg.model_copy(update={
                "pipeline": cfg.pipeline.model_copy(update={"active_variants": current})
            })
        self.save(updated)
        return updated

    @property
    def config(self) -> AgentsConfig:
        if self._config is None:
            self.load()
        return self._config


# Module-level singleton — import this everywhere
_loader = AgentsConfigLoader()


def get_agents_config() -> AgentsConfig:
    """Returns the current validated config. Loads on first call."""
    return _loader.config


def reload_agents_config() -> AgentsConfig:
    """Reloads agents_config.yaml from disk and returns the new config."""
    return _loader.reload()


def add_variant(variant: ModelVariant) -> AgentsConfig:
    return _loader.add_variant(variant)


def remove_variant(variant_id: str) -> AgentsConfig:
    return _loader.remove_variant(variant_id)


def set_variant_active(variant_id: str, active: bool) -> AgentsConfig:
    return _loader.set_variant_active(variant_id, active)


def add_agent(name: str, agent_cfg: AgentConfig) -> AgentsConfig:
    return _loader.add_agent(name, agent_cfg)


def remove_agent(name: str) -> AgentsConfig:
    return _loader.remove_agent(name)
