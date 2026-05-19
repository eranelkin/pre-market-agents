from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class VariantResultSnapshot(BaseModel):
    """One variant's final output for a single ticker."""
    rank: int
    final_score: float = Field(..., ge=0, le=100)
    recommendation: str
    confidence: float = Field(..., ge=0, le=1)
    override_applied: bool = False

    @field_validator("recommendation", mode="before")
    @classmethod
    def normalize(cls, v: str) -> str:
        return v.strip().upper()


# Direction buckets used for agreement checks
_BUY_RECS = {"STRONG_BUY", "BUY"}
_SELL_RECS = {"SELL", "STRONG_SELL"}


def _direction(rec: str) -> str:
    if rec in _BUY_RECS:
        return "buy"
    if rec in _SELL_RECS:
        return "sell"
    return "hold"


class ComparisonItem(BaseModel):
    """Cross-variant comparison for a single ticker within a session."""
    ticker: str
    # variant_id → snapshot
    variant_results: dict[str, VariantResultSnapshot]
    # True when all variants agree on buy/hold/sell direction
    recommendation_agreement: bool
    # True when all variants place the ticker in the same score quartile
    score_quartile_agreement: bool
    max_rank_diff: int
    max_score_diff: float
    # Set only when all variants agree on the exact recommendation
    consensus_recommendation: Optional[str] = None

    @classmethod
    def build(cls, ticker: str, variant_results: dict[str, VariantResultSnapshot]) -> "ComparisonItem":
        scores = [r.final_score for r in variant_results.values()]
        ranks = [r.rank for r in variant_results.values()]
        recs = [r.recommendation for r in variant_results.values()]
        directions = [_direction(r) for r in recs]

        max_score_diff = max(scores) - min(scores)
        max_rank_diff = max(ranks) - min(ranks)
        rec_agreement = len(set(directions)) == 1
        quartile_agreement = len({int(s // 25) for s in scores}) == 1
        consensus = recs[0] if len(set(recs)) == 1 else None

        return cls(
            ticker=ticker,
            variant_results=variant_results,
            recommendation_agreement=rec_agreement,
            score_quartile_agreement=quartile_agreement,
            max_rank_diff=max_rank_diff,
            max_score_diff=round(max_score_diff, 2),
            consensus_recommendation=consensus,
        )


class ComparisonOutput(BaseModel):
    """Full cross-variant comparison result for a session."""
    session_id: UUID
    process_id: str
    variants_compared: list[str]
    total_stocks: int
    # Percentage of stocks where all variants agreed on buy/hold/sell direction
    direction_agreement_rate: float = Field(..., ge=0, le=1)
    # Percentage where all variants gave exact same recommendation
    exact_agreement_rate: float = Field(..., ge=0, le=1)
    stocks: list[ComparisonItem]

    @classmethod
    def build(cls, session_id: UUID, process_id: str, stocks: list[ComparisonItem]) -> "ComparisonOutput":
        n = len(stocks)
        direction_agreed = sum(1 for s in stocks if s.recommendation_agreement)
        exact_agreed = sum(1 for s in stocks if s.consensus_recommendation is not None)
        variants = sorted(stocks[0].variant_results.keys()) if stocks else []

        return cls(
            session_id=session_id,
            process_id=process_id,
            variants_compared=variants,
            total_stocks=n,
            direction_agreement_rate=round(direction_agreed / n, 4) if n else 0.0,
            exact_agreement_rate=round(exact_agreed / n, 4) if n else 0.0,
            stocks=stocks,
        )
