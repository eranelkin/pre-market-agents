from backend.agents.base_agent import BaseAgent


class MacroAgent(BaseAgent):
    """Uses web search (enable_web_search=true in agents_config.yaml)."""
    agent_name = "macro"
