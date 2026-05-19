from typing import Any

import structlog

from backend.schemas.agent_schema import ChunkResult

log = structlog.get_logger()

# The canonical list of the five analysis agents
ANALYSIS_AGENTS = ["technical", "fundamental", "sentiment", "risk", "macro"]


def merge(chunk_results: list[ChunkResult]) -> dict[str, dict[str, Any]]:
    """
    Flatten all ChunkResults into {ticker: {agent_name: output_dict}}.

    Each ChunkResult covers a subset of stocks; together they cover all stocks
    in the run.  If an agent failed for a given ticker its data is simply absent
    from that ticker's dict — the CEO component handles missing agents gracefully.
    """
    merged: dict[str, dict[str, Any]] = {}

    for chunk in chunk_results:
        for agent_name, batch_result in chunk.agent_results.items():
            for ticker, output in batch_result.parsed_output.items():
                merged.setdefault(ticker, {})[agent_name] = output

    # Log any gaps so operators can spot partial failures quickly
    gaps: dict[str, list[str]] = {}
    for ticker, agent_outputs in merged.items():
        missing = [a for a in ANALYSIS_AGENTS if a not in agent_outputs]
        if missing:
            gaps[ticker] = missing

    if gaps:
        log.warning("merger_gaps_detected", gaps=gaps)
    else:
        log.debug("merger_complete", tickers=sorted(merged.keys()))

    return merged


def format_for_ceo(merged: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Convert the nested merger output into a flat list that the CEO prompt
    can consume.

    Each element represents one stock with all five agent outputs merged at
    the top level alongside the ticker:

        {
            "ticker": "AAPL",
            "technical": { tech_score, primary_signal, ... },
            "fundamental": { fund_score, valuation_verdict, ... },
            "sentiment": { sentiment_score, sentiment_trend, catalyst_type, ... },
            "risk": { risk_score, risk_level, ... },
            "macro": { macro_score, sector_stance, ... },
        }

    Stocks that have zero agent data are excluded (they can't be scored).
    """
    result = []
    for ticker, agent_outputs in sorted(merged.items()):
        if not agent_outputs:
            log.warning("merger_ticker_no_agent_data", ticker=ticker)
            continue
        entry: dict[str, Any] = {"ticker": ticker}
        for agent_name in ANALYSIS_AGENTS:
            if agent_name in agent_outputs:
                entry[agent_name] = agent_outputs[agent_name]
        result.append(entry)
    return result
