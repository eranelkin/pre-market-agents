from uuid import UUID

import structlog

from backend.schemas.comparison_schema import (
    ComparisonItem,
    ComparisonOutput,
    VariantResultSnapshot,
)
from backend.schemas.result_schema import CEOOutput, FinalResultItem

log = structlog.get_logger()


class Comparator:
    """
    Produces a cross-variant comparison for a single session.

    Receives one CEOOutput per model variant, aligns results by ticker,
    and delegates all statistical computation to the schema's build() methods.

    Tickers that appear in only one variant are excluded from the comparison
    (there is nothing to diff against).
    """

    def compare(
        self,
        ceo_outputs: dict[str, CEOOutput],  # {variant_id: CEOOutput}
        session_id: UUID,
        process_id: str,
    ) -> ComparisonOutput:
        if len(ceo_outputs) < 2:
            raise ValueError(
                f"Comparison requires at least 2 variants; got {len(ceo_outputs)}"
            )

        # Build {variant_id: {ticker: FinalResultItem}} for fast lookup
        variant_maps: dict[str, dict[str, FinalResultItem]] = {
            variant_id: {item.ticker: item for item in output.stocks}
            for variant_id, output in ceo_outputs.items()
        }

        all_tickers: set[str] = set()
        for ticker_map in variant_maps.values():
            all_tickers.update(ticker_map.keys())

        comparison_items: list[ComparisonItem] = []
        skipped: list[str] = []

        for ticker in sorted(all_tickers):
            snapshots: dict[str, VariantResultSnapshot] = {}
            for variant_id, ticker_map in variant_maps.items():
                if ticker in ticker_map:
                    item = ticker_map[ticker]
                    snapshots[variant_id] = VariantResultSnapshot(
                        rank=item.rank,
                        final_score=item.final_score,
                        recommendation=item.recommendation,
                        confidence=item.confidence,
                        override_applied=item.override_applied,
                    )

            if len(snapshots) < 2:
                # Ticker only present in one variant — nothing to compare
                skipped.append(ticker)
                continue

            comparison_items.append(ComparisonItem.build(ticker, snapshots))

        if skipped:
            log.warning(
                "comparator_tickers_skipped_single_variant",
                skipped=skipped,
            )

        result = ComparisonOutput.build(session_id, process_id, comparison_items)

        log.info(
            "comparison_complete",
            session_id=str(session_id),
            variants=list(ceo_outputs.keys()),
            tickers_compared=len(comparison_items),
            direction_agreement_rate=result.direction_agreement_rate,
            exact_agreement_rate=result.exact_agreement_rate,
        )
        return result
