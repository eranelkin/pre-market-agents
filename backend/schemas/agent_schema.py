from dataclasses import dataclass
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ── LLM call result (returned by every provider) ──────────────────────────────

@dataclass
class LLMResponse:
    content: str
    provider_used: str
    model_used: str
    was_fallback: bool
    web_search_used: bool
    tokens_used: int
    latency_ms: int


# ── Per-agent output models (one ticker, validated from AI YAML) ───────────────

def _coerce_lower(v: str) -> str:
    return v.strip().lower() if isinstance(v, str) else v


class TechnicalAgentOutput(BaseModel):
    ticker: str
    tech_score: float = Field(..., ge=0, le=100)
    primary_signal: Literal["bullish", "bearish", "neutral"]
    ma_alignment: str
    volume_signal: str
    key_level_proximity: str
    signal_strength: Literal["weak", "moderate", "strong"]
    reasoning: str

    @field_validator("primary_signal", "signal_strength", mode="before")
    @classmethod
    def normalize(cls, v: str) -> str:
        return _coerce_lower(v)


class FundamentalAgentOutput(BaseModel):
    ticker: str
    fund_score: float = Field(..., ge=0, le=100)
    valuation_verdict: Literal["cheap", "fair", "expensive"]
    growth_quality: Literal["strong", "moderate", "weak"]
    balance_sheet_health: Literal["strong", "adequate", "stressed"]
    risk_flags: list[str] = Field(default_factory=list)
    reasoning: str

    @field_validator("valuation_verdict", "growth_quality", "balance_sheet_health", mode="before")
    @classmethod
    def normalize(cls, v: str) -> str:
        return _coerce_lower(v)


class SentimentAgentOutput(BaseModel):
    ticker: str
    sentiment_score: float = Field(..., ge=0, le=100)
    sentiment_trend: Literal["improving", "stable", "deteriorating"]
    catalyst_flag: bool
    catalyst_type: Literal["earnings", "product", "macro", "none"]
    analyst_conviction: Literal["high", "medium", "low"]
    reasoning: str

    @field_validator("sentiment_trend", "catalyst_type", "analyst_conviction", mode="before")
    @classmethod
    def normalize(cls, v: str) -> str:
        return _coerce_lower(v)


class RiskAgentOutput(BaseModel):
    """risk_score is INVERTED: higher value = lower risk = better outcome."""
    ticker: str
    risk_score: float = Field(..., ge=0, le=100, description="INVERTED — higher = lower risk")
    risk_level: Literal["low", "medium", "high", "extreme"]
    beta_assessment: str
    volatility_regime: Literal["low", "normal", "elevated", "extreme"]
    key_risks: list[str] = Field(default_factory=list)
    reasoning: str

    @field_validator("risk_level", "volatility_regime", mode="before")
    @classmethod
    def normalize(cls, v: str) -> str:
        return _coerce_lower(v)


class MacroAgentOutput(BaseModel):
    ticker: str
    macro_score: float = Field(..., ge=0, le=100)
    sector_stance: Literal["overweight", "neutral", "underweight"]
    macro_alignment: Literal["tailwind", "neutral", "headwind"]
    catalyst_timing: Literal["near", "medium", "distant", "none"]
    reasoning: str

    @field_validator("sector_stance", "macro_alignment", "catalyst_timing", mode="before")
    @classmethod
    def normalize(cls, v: str) -> str:
        return _coerce_lower(v)


# Union of all agent output types for type-checking convenience
AgentTickerOutput = (
    TechnicalAgentOutput
    | FundamentalAgentOutput
    | SentimentAgentOutput
    | RiskAgentOutput
    | MacroAgentOutput
)

AGENT_OUTPUT_MODELS: dict[str, type] = {
    "technical": TechnicalAgentOutput,
    "fundamental": FundamentalAgentOutput,
    "sentiment": SentimentAgentOutput,
    "risk": RiskAgentOutput,
    "macro": MacroAgentOutput,
}

class GenericAgentOutput(BaseModel):
    """Fallback output model for custom agents not in the built-in registry."""
    model_config = ConfigDict(extra="allow")
    ticker: str


# Score field name per agent — used by merger and CEO
AGENT_SCORE_FIELD: dict[str, str] = {
    "technical": "tech_score",
    "fundamental": "fund_score",
    "sentiment": "sentiment_score",
    "risk": "risk_score",
    "macro": "macro_score",
}


def get_agent_output_model(agent_name: str) -> type:
    """Return the Pydantic output model for an agent; falls back to GenericAgentOutput."""
    return AGENT_OUTPUT_MODELS.get(agent_name, GenericAgentOutput)


def get_agent_score_field(agent_name: str) -> str:
    """Return the score field name for an agent; falls back to '{name}_score' convention."""
    return AGENT_SCORE_FIELD.get(agent_name, f"{agent_name}_score")


# ── Batch result: full output for one agent across one chunk ──────────────────

class AgentBatchResult(BaseModel):
    agent_name: str
    batch_id: UUID
    run_id: UUID
    provider_used: str
    model_used: str
    was_fallback: bool
    web_search_used: bool = False
    raw_prompt: str
    raw_response: str
    # ticker → validated agent output dict (serialized from AgentTickerOutput)
    parsed_output: dict[str, Any]
    tokens_used: int
    latency_ms: int

    @classmethod
    def empty(cls, agent_name: str, batch_id: UUID, run_id: UUID) -> "AgentBatchResult":
        """Null result used when an agent fails completely — pipeline continues."""
        return cls(
            agent_name=agent_name,
            batch_id=batch_id,
            run_id=run_id,
            provider_used="none",
            model_used="none",
            was_fallback=False,
            web_search_used=False,
            raw_prompt="",
            raw_response="",
            parsed_output={},
            tokens_used=0,
            latency_ms=0,
        )


# ── Chunk result: all 5 agents for one chunk ──────────────────────────────────

class ChunkResult(BaseModel):
    batch_id: UUID
    run_id: UUID
    # agent_name → AgentBatchResult
    agent_results: dict[str, AgentBatchResult]
    failed_agents: list[str] = Field(default_factory=list)
