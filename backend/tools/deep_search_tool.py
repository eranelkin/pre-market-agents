import structlog

from backend.tools.web_search_tool import WebSearchTool

log = structlog.get_logger()


class DeepSearchTool(WebSearchTool):
    """
    In-depth web search that returns more results and, for Tavily,
    uses advanced search depth with full-page content extraction.
    Use when thorough research is needed (SEC filings, analyst reports,
    historical financials) rather than a quick news headline lookup.
    """

    _tool_name = "deep_search"
    _tool_description = (
        "Perform an in-depth web search with comprehensive result extraction. "
        "Returns more results than web_search and includes full page content where available. "
        "Use for SEC filings, detailed analyst reports, historical financials, or when "
        "web_search results are insufficient."
    )
    _search_depth = "advanced"

    def __init__(self, provider: str, api_key: str, max_results: int = 10) -> None:
        super().__init__(provider=provider, api_key=api_key, max_results=max_results)


def get_deep_search_tool() -> DeepSearchTool | None:
    """
    Factory that reads search config and returns a ready DeepSearchTool,
    or None if no API key is configured for the active provider.
    """
    from backend.config import settings
    from backend.agents_config_loader import get_agents_config
    from backend.tools.web_search_tool import _resolve_api_key

    provider = settings.search_provider.lower()
    api_key = _resolve_api_key(provider)
    if not api_key:
        log.warning("deep_search_tool_skipped_no_api_key", provider=provider)
        return None

    cfg = get_agents_config()
    # Deep search uses 2× the configured max_results, capped at 10
    base = cfg.search.max_results if cfg.search else 5
    max_results = min(base * 2, 10)
    return DeepSearchTool(provider=provider, api_key=api_key, max_results=max_results)
