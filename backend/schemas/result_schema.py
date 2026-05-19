from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


# ── CEO component output (parsed from AI YAML) ────────────────────────────────

Recommendation = Literal["STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL"]

# Thresholds matching the CEO scoring rubric
RECOMMENDATION_THRESHOLDS: list[tuple[float, str]] = [
    (80.0, "STRONG_BUY"),
    (65.0, "BUY"),
    (45.0, "HOLD"),
    (30.0, "SELL"),
    (0.0, "STRONG_SELL"),
]


def score_to_recommendation(score: float) -> str:
    for threshold, label in RECOMMENDATION_THRESHOLDS:
        if score >= threshold:
            return label
    return "STRONG_SELL"


class KeySignals(BaseModel):
    technical: Optional[str] = None
    fundamental: Optional[str] = None
    sentiment: Optional[str] = None
    risk: Optional[str] = None
    macro: Optional[str] = None


class FinalResultItem(BaseModel):
    ticker: str
    final_score: float = Field(..., ge=0, le=100)
    rank: int = Field(..., ge=1)
    recommendation: str
    confidence: float = Field(..., ge=0, le=1)
    technical_score: Optional[float] = Field(None, ge=0, le=100)
    fundamental_score: Optional[float] = Field(None, ge=0, le=100)
    sentiment_score: Optional[float] = Field(None, ge=0, le=100)
    # INVERTED: higher = lower risk = better
    risk_score: Optional[float] = Field(None, ge=0, le=100)
    macro_score: Optional[float] = Field(None, ge=0, le=100)
    override_applied: bool = False
    override_reason: Optional[str] = None
    conflicting_signals: list[str] = Field(default_factory=list)
    key_signals: Optional[KeySignals] = None
    ceo_rationale: Optional[str] = None

    @field_validator("recommendation", mode="before")
    @classmethod
    def normalize_recommendation(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("ticker", mode="before")
    @classmethod
    def normalize_ticker(cls, v: str) -> str:
        return v.strip().upper()


class Top3Pick(BaseModel):
    ticker: str
    rank: int
    entry_rationale: str

    @field_validator("ticker", mode="before")
    @classmethod
    def normalize_ticker(cls, v: str) -> str:
        return v.strip().upper()


class RedFlag(BaseModel):
    ticker: str
    reason: str

    @field_validator("ticker", mode="before")
    @classmethod
    def normalize_ticker(cls, v: str) -> str:
        return v.strip().upper()


class CEOOutput(BaseModel):
    stocks: list[FinalResultItem]
    top_3_picks: list[Top3Pick] = Field(default_factory=list)
    red_flags: list[RedFlag] = Field(default_factory=list)


# ── API response models ────────────────────────────────────────────────────────

class RunProgressResponse(BaseModel):
    total_chunks: int
    chunks_completed: int
    total_stocks: int
    stage: Literal["parsing", "chunking", "agents_running", "ceo_evaluating", "complete", "failed"]


class RunStatusResponse(BaseModel):
    run_id: UUID
    session_id: UUID
    model_variant_id: str
    status: str
    progress: Optional[RunProgressResponse] = None
    error_message: Optional[str] = None


class SessionStatusResponse(BaseModel):
    session_id: UUID
    process_id: str
    status: str
    active_variants: list[str]
    total_stocks: int
    runs: list[RunStatusResponse]


class RunResultsResponse(BaseModel):
    run_id: UUID
    session_id: UUID
    model_variant_id: str
    provider_used: Optional[str]
    model_used: Optional[str]
    total_stocks: int
    results: list[FinalResultItem]
    top_3_picks: list[Top3Pick]
    red_flags: list[RedFlag]


class RunSummaryResponse(BaseModel):
    """Returned in paginated list of historical runs."""
    session_id: UUID
    run_id: UUID
    process_id: str
    model_variant_id: str
    status: str
    total_stocks: int
    started_at: str
    completed_at: Optional[str] = None
    duration_seconds: Optional[float] = None


class AgentBreakdownResponse(BaseModel):
    """Per-ticker agent detail — GET /run/{run_id}/agents/{ticker}."""
    ticker: str
    run_id: UUID
    agents: dict[str, Any]  # agent_name → {score, raw fields, provider_used, model_used, was_fallback, latency_ms}
