from backend.agents.base_agent import BaseAgent


class SentimentAgent(BaseAgent):
    """Uses web search (enable_web_search=true in agents_config.yaml)."""
    agent_name = "sentiment"
