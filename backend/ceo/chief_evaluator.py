import asyncio
import json
import re
from typing import Any
from uuid import UUID

import structlog
import yaml

from backend.ceo import scoring_rubric
from backend.schemas.result_schema import (
    CEOOutput, FinalResultItem, RedFlag, Top3Pick,
)
from backend.utils.llm_client import build_llm_client_for_agent
from backend.utils.prompt_manager import get_prompt_manager

log = structlog.get_logger()

_AGENT_KEYS = ["technical", "fundamental", "sentiment", "risk", "macro"]
_FENCE_RE = re.compile(r"```(?:yaml)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)


class ChiefEvaluator:
    """
    CEO component — scores, applies override rules, and ranks all stocks.

    Strategy:
    1.  Call the CEO LLM (for rationale, confidence, conflicting signals).
    2.  Parse its YAML response.
    3.  Enforce programmatic scoring and overrides regardless of LLM output.
    4.  Fall back to a fully programmatic result if the LLM call fails.
    """

    AGENT_NAME = "ceo"

    def __init__(self, override_variant_id: str | None = None) -> None:
        self._override_variant_id = override_variant_id

    async def evaluate(self, ceo_input: list[dict[str, Any]], run_id: UUID) -> CEOOutput:
        from backend.agents_config_loader import get_agents_config

        agent_cfg = get_agents_config().get_agent(self.AGENT_NAME)

        try:
            llm_output = await asyncio.wait_for(
                self._call_llm(ceo_input, agent_cfg),
                timeout=float(agent_cfg.timeout_seconds),
            )
        except Exception as exc:
            log.warning(
                "ceo_llm_failed_using_programmatic_fallback",
                run_id=str(run_id),
                error=str(exc),
            )
            llm_output = None

        return self._build_final(ceo_input, llm_output)

    # ── LLM call ──────────────────────────────────────────────────────────────

    async def _call_llm(self, ceo_input: list[dict], agent_cfg) -> CEOOutput | None:
        enriched = self._enrich_with_scores(ceo_input)
        system_prompt = get_prompt_manager().get(self.AGENT_NAME)
        user_content = (
            f"Score and rank the following {len(enriched)} stock(s). "
            f"The `_computed` field in each entry shows the pre-calculated weighted score "
            f"and any active overrides — use these as your starting point.\n\n"
            f"```json\n{json.dumps(enriched, indent=2, default=str)}\n```"
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]

        client, primary, fallback = build_llm_client_for_agent(
            self.AGENT_NAME, self._override_variant_id
        )
        resp = await client.call(
            messages=messages,
            variant=primary,
            max_tokens=agent_cfg.max_tokens,
            agent_name=self.AGENT_NAME,
            fallback_variant=fallback,
        )

        return self._parse_ceo_yaml(resp.content)

    def _parse_ceo_yaml(self, content: str) -> CEOOutput | None:
        text = content
        m = _FENCE_RE.search(text)
        if m:
            text = m.group(1)
        try:
            data = yaml.safe_load(text)
            if isinstance(data, dict):
                return CEOOutput.model_validate(data)
        except Exception as exc:
            log.warning("ceo_yaml_parse_failed", error=str(exc), preview=content[:300])
        return None

    # ── Score enrichment (gives the LLM accurate context) ────────────────────

    def _enrich_with_scores(self, ceo_input: list[dict]) -> list[dict]:
        enriched = []
        for stock in ceo_input:
            tech, fund, sentiment, risk, macro, risk_level, catalyst_type, sentiment_trend = (
                self._extract_fields(stock)
            )
            base = scoring_rubric.weighted_score(tech, fund, sentiment, risk, macro)
            adjusted, _, reason = scoring_rubric.apply_overrides(
                base, risk_level, tech, fund, catalyst_type, sentiment_trend
            )
            entry = dict(stock)
            entry["_computed"] = {
                "weighted_score": base,
                "adjusted_score": adjusted,
                "override_note": reason,
            }
            enriched.append(entry)
        return enriched

    # ── Programmatic enforcement (always runs, even after LLM) ───────────────

    def _build_final(
        self, ceo_input: list[dict], llm_output: CEOOutput | None
    ) -> CEOOutput:
        """
        Compute definitive scores for every ticker, merging LLM text fields
        where available.  Scores, ranks, overrides, and recommendations are
        always determined programmatically.
        """
        # Build a lookup from the LLM output for text-only fields
        llm_items: dict[str, FinalResultItem] = {}
        if llm_output:
            llm_items = {item.ticker: item for item in llm_output.stocks}

        items: list[FinalResultItem] = []
        for stock in ceo_input:
            ticker = stock["ticker"]
            tech, fund, sentiment, risk, macro, risk_level, catalyst_type, sentiment_trend = (
                self._extract_fields(stock)
            )

            base = scoring_rubric.weighted_score(tech, fund, sentiment, risk, macro)
            final, override, reason = scoring_rubric.apply_overrides(
                base, risk_level, tech, fund, catalyst_type, sentiment_trend
            )
            rec = scoring_rubric.finalize_recommendation(final, tech, fund)

            agents_present = sum(1 for k in _AGENT_KEYS if k in stock)
            llm_item = llm_items.get(ticker)

            items.append(
                FinalResultItem(
                    ticker=ticker,
                    final_score=final,
                    rank=0,  # assigned after sorting
                    recommendation=rec,
                    confidence=llm_item.confidence if llm_item else scoring_rubric.compute_confidence(agents_present),
                    technical_score=tech,
                    fundamental_score=fund,
                    sentiment_score=sentiment,
                    risk_score=risk,
                    macro_score=macro,
                    override_applied=override,
                    override_reason=reason,
                    conflicting_signals=llm_item.conflicting_signals if llm_item else [],
                    key_signals=llm_item.key_signals if llm_item else None,
                    ceo_rationale=llm_item.ceo_rationale if llm_item else None,
                )
            )

        # Sort descending by final_score and assign ranks
        items.sort(key=lambda x: x.final_score, reverse=True)
        ranked = [item.model_copy(update={"rank": i + 1}) for i, item in enumerate(items)]

        top_3 = self._build_top3(ranked, llm_output)
        red_flags = self._build_red_flags(ranked, ceo_input, llm_output)

        log.info(
            "ceo_evaluation_complete",
            stocks_ranked=len(ranked),
            top_ticker=ranked[0].ticker if ranked else None,
            overrides_applied=sum(1 for r in ranked if r.override_applied),
            red_flag_count=len(red_flags),
            source="llm+programmatic" if llm_output else "programmatic_only",
        )
        return CEOOutput(stocks=ranked, top_3_picks=top_3, red_flags=red_flags)

    def _build_top3(
        self, ranked: list[FinalResultItem], llm_output: CEOOutput | None
    ) -> list[Top3Pick]:
        llm_rationale: dict[str, str] = {}
        if llm_output:
            llm_rationale = {p.ticker: p.entry_rationale for p in llm_output.top_3_picks}
        result = []
        for item in ranked[:3]:
            result.append(
                Top3Pick(
                    ticker=item.ticker,
                    rank=item.rank,
                    entry_rationale=llm_rationale.get(
                        item.ticker,
                        f"Ranked #{item.rank} with score {item.final_score:.1f} "
                        f"({item.recommendation}).",
                    ),
                )
            )
        return result

    def _build_red_flags(
        self,
        ranked: list[FinalResultItem],
        ceo_input: list[dict],
        llm_output: CEOOutput | None,
    ) -> list[RedFlag]:
        ticker_data = {s["ticker"]: s for s in ceo_input}
        llm_reasons: dict[str, str] = {}
        if llm_output:
            llm_reasons = {rf.ticker: rf.reason for rf in llm_output.red_flags}

        flags = []
        for item in ranked:
            data = ticker_data.get(item.ticker, {})
            risk_level = data.get("risk", {}).get("risk_level", "")
            if item.final_score < 30 or risk_level == "extreme":
                flags.append(
                    RedFlag(
                        ticker=item.ticker,
                        reason=llm_reasons.get(
                            item.ticker,
                            f"Score {item.final_score:.1f} "
                            + (f"with {risk_level} risk level." if risk_level else "."),
                        ),
                    )
                )
        return flags

    # ── Field extraction helper ───────────────────────────────────────────────

    @staticmethod
    def _extract_fields(
        stock: dict,
    ) -> tuple[
        float | None, float | None, float | None,
        float | None, float | None,
        str | None, str | None, str | None,
    ]:
        t = stock.get("technical") or {}
        f = stock.get("fundamental") or {}
        s = stock.get("sentiment") or {}
        r = stock.get("risk") or {}
        m = stock.get("macro") or {}
        return (
            t.get("tech_score"),
            f.get("fund_score"),
            s.get("sentiment_score"),
            r.get("risk_score"),
            m.get("macro_score"),
            r.get("risk_level"),
            s.get("catalyst_type"),
            s.get("sentiment_trend"),
        )
