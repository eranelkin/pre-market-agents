"""
Deterministic scoring logic used by ChiefEvaluator.

These functions are the ground truth for all numeric outputs.  The LLM call
enriches the result with rationale and confidence; all scores, overrides, and
rankings are enforced programmatically regardless of what the LLM returns.

CEO weight breakdown:
    Technical   30%
    Fundamental 25%
    Sentiment   20%
    Risk        15%  ← risk_score is INVERTED (higher = lower risk = better)
    Macro       10%
"""

from backend.schemas.result_schema import score_to_recommendation

_WEIGHTS: list[tuple[float, float]] = [
    # (weight, ...)  aligned with (tech, fund, sentiment, risk, macro)
]


def weighted_score(
    tech: float | None,
    fund: float | None,
    sentiment: float | None,
    risk: float | None,
    macro: float | None,
) -> float:
    """
    Compute the base weighted score, normalising for missing agents.
    Missing agents are omitted from the denominator so absent data
    doesn't drag the score toward 0.
    Returns a value in [0, 100], rounded to 2 decimal places.
    """
    agents = [
        (tech, 0.30),
        (fund, 0.25),
        (sentiment, 0.20),
        (risk, 0.15),
        (macro, 0.10),
    ]
    total_score = 0.0
    total_weight = 0.0
    for value, weight in agents:
        if value is not None:
            total_score += value * weight
            total_weight += weight

    if total_weight == 0.0:
        return 50.0  # no data at all — neutral
    return round(total_score / total_weight, 2)


def apply_overrides(
    score: float,
    risk_level: str | None,
    tech_score: float | None,
    fund_score: float | None,
    catalyst_type: str | None,
    sentiment_trend: str | None,
) -> tuple[float, bool, str | None]:
    """
    Apply mandatory CEO override rules in order.  All applicable rules fire.

    Rule 1 — Extreme risk cap: risk_level == "extreme" → cap at 50
    Rule 2 — Double-low floor: handled separately in finalize_recommendation()
    Rule 3 — Earnings catalyst ±5: catalyst_type == "earnings" ±5 based on trend

    Returns (adjusted_score, override_applied, human-readable reason or None).
    """
    adjusted = score
    reasons: list[str] = []

    # Rule 1
    if risk_level == "extreme" and adjusted > 50:
        adjusted = 50.0
        reasons.append("Extreme risk level — score capped at 50")

    # Rule 3  (Rule 2 is enforced in finalize_recommendation)
    if catalyst_type == "earnings":
        if sentiment_trend == "improving":
            adjusted = min(adjusted + 5.0, 100.0)
            reasons.append("Earnings catalyst + improving sentiment: +5")
        elif sentiment_trend == "deteriorating":
            adjusted = max(adjusted - 5.0, 0.0)
            reasons.append("Earnings catalyst + deteriorating sentiment: −5")

    override_applied = bool(reasons)
    reason = "; ".join(reasons) if reasons else None
    return round(adjusted, 2), override_applied, reason


def finalize_recommendation(
    score: float,
    tech_score: float | None,
    fund_score: float | None,
) -> str:
    """
    Threshold-based recommendation with the double-low floor applied.

    Rule 2: if tech_score < 30 AND fund_score < 30 → minimum SELL,
    regardless of the computed recommendation.
    """
    rec = score_to_recommendation(score)
    if (
        tech_score is not None
        and fund_score is not None
        and tech_score < 30
        and fund_score < 30
        and rec in ("HOLD", "BUY", "STRONG_BUY")
    ):
        rec = "SELL"
    return rec


def compute_confidence(agents_present: int, total_agents: int = 5) -> float:
    """
    Rough confidence based on fraction of agents that returned data.
        All 5 present → 0.85
        3–4 present   → 0.65
        1–2 present   → 0.40
    """
    ratio = agents_present / max(total_agents, 1)
    if ratio >= 1.0:
        return 0.85
    elif ratio >= 0.6:
        return 0.65
    return 0.40
