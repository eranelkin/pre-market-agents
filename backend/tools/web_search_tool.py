import structlog

from backend.tools.base_tool import BaseTool

log = structlog.get_logger()


def _format_results(
    query: str,
    results: list[dict],
    title_key: str,
    snippet_key: str,
    url_key: str,
) -> str:
    if not results:
        return f'No search results found for: "{query}"'
    lines = [f'Web search results for "{query}":\n']
    for i, r in enumerate(results, 1):
        title = r.get(title_key) or "Untitled"
        url = r.get(url_key) or ""
        snippet = r.get(snippet_key) or ""
        lines.append(f"{i}. {title}\n   {url}\n   {snippet}\n")
    return "\n".join(lines)


class WebSearchTool(BaseTool):
    """
    Tool-use web search for providers that support function calling.
    Supports Tavily (default), Brave, and SerpAPI backends.
    The search backend is selected from settings.search_provider.
    """

    _tool_name = "web_search"
    _tool_description = (
        "Search the web for recent financial news, earnings reports, analyst ratings, "
        "SEC filings, or market data. Use when real-time context is needed that may not "
        "be in your training data. Include the ticker symbol and specific topic in the query."
    )
    _search_depth = "basic"

    def __init__(self, provider: str, api_key: str, max_results: int = 5) -> None:
        self._provider = provider.lower()
        self._api_key = api_key
        self._max_results = max_results

    @property
    def name(self) -> str:
        return self._tool_name

    @property
    def description(self) -> str:
        return self._tool_description

    @property
    def parameters_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "The search query. Be specific: include company name, ticker symbol, "
                        "and the topic (e.g. 'AAPL Q2 2025 earnings results analyst reaction')."
                    ),
                }
            },
            "required": ["query"],
        }

    async def execute(self, query: str, **_: object) -> str:  # type: ignore[override]
        log.debug("web_search_execute", provider=self._provider, query=query[:80])
        if self._provider == "tavily":
            return await self._tavily(query)
        elif self._provider == "brave":
            return await self._brave(query)
        elif self._provider == "serpapi":
            return await self._serpapi(query)
        else:
            raise ValueError(f"Unsupported search provider: {self._provider!r}")

    async def _tavily(self, query: str) -> str:
        from tavily import AsyncTavilyClient  # type: ignore[import]

        client = AsyncTavilyClient(api_key=self._api_key)
        resp = await client.search(
            query,
            max_results=self._max_results,
            search_depth=self._search_depth,
        )
        results = resp.get("results", [])
        return _format_results(query, results, "title", "content", "url")

    async def _brave(self, query: str) -> str:
        import httpx

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                params={"q": query, "count": self._max_results},
                headers={
                    "X-Subscription-Token": self._api_key,
                    "Accept": "application/json",
                },
            )
            resp.raise_for_status()
            data = resp.json()
        results = data.get("web", {}).get("results", [])
        return _format_results(query, results, "title", "description", "url")

    async def _serpapi(self, query: str) -> str:
        import httpx

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://serpapi.com/search",
                params={
                    "q": query,
                    "api_key": self._api_key,
                    "engine": "google",
                    "num": self._max_results,
                },
            )
            resp.raise_for_status()
            data = resp.json()
        results = data.get("organic_results", [])
        return _format_results(query, results, "title", "snippet", "link")


def _resolve_api_key(provider: str) -> str | None:
    from backend.config import settings

    mapping = {
        "tavily": settings.tavily_api_key,
        "brave": settings.brave_api_key,
        "serpapi": settings.serpapi_api_key,
    }
    return mapping.get(provider)


def get_web_search_tool() -> WebSearchTool | None:
    """
    Factory that reads search config and returns a ready WebSearchTool,
    or None if no API key is configured for the active provider.
    """
    from backend.config import settings
    from backend.agents_config_loader import get_agents_config

    provider = settings.search_provider.lower()
    api_key = _resolve_api_key(provider)
    if not api_key:
        log.warning("web_search_tool_skipped_no_api_key", provider=provider)
        return None

    cfg = get_agents_config()
    max_results = cfg.search.max_results if cfg.search else 5
    return WebSearchTool(provider=provider, api_key=api_key, max_results=max_results)
