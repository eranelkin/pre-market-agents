import threading
from pathlib import Path
from typing import Optional

import structlog

log = structlog.get_logger()

# Three levels up from backend/utils/ → project root
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class PromptManager:
    """
    Loads each agent's prompt from the file path declared in agents_config.yaml.
    All paths are resolved relative to the project root.
    Thread-safe; supports hot-reload via reload().
    """

    def __init__(self, base_dir: Optional[Path] = None) -> None:
        self._base_dir = base_dir or _PROJECT_ROOT
        self._prompts: dict[str, str] = {}
        self._lock = threading.RLock()

    def load(self) -> None:
        """Read all prompt files from config. Call once during app startup."""
        from backend.agents_config_loader import get_agents_config

        cfg = get_agents_config()
        with self._lock:
            for agent_name, agent_cfg in cfg.agents.items():
                self._load_one(agent_name, agent_cfg.prompt_file)

    def _load_one(self, agent_name: str, prompt_file: str) -> bool:
        path = self._base_dir / prompt_file
        try:
            content = path.read_text(encoding="utf-8").strip()
            self._prompts[agent_name] = content
            log.debug("prompt_loaded", agent=agent_name, path=str(path))
            return True
        except FileNotFoundError:
            log.error("prompt_file_not_found", agent=agent_name, path=str(path))
            return False
        except Exception as e:
            log.error("prompt_load_failed", agent=agent_name, path=str(path), error=str(e))
            return False

    def get(self, agent_name: str) -> str:
        with self._lock:
            if agent_name not in self._prompts:
                # Lazy-load from the current config (respects test/prod ContextVar during runs)
                from backend.agents_config_loader import get_agents_config
                try:
                    cfg = get_agents_config()
                    if agent_name in cfg.agents:
                        if self._load_one(agent_name, cfg.agents[agent_name].prompt_file):
                            return self._prompts[agent_name]
                except Exception:
                    pass
                raise KeyError(
                    f"No prompt loaded for agent '{agent_name}'. "
                    "Ensure PromptManager.load() was called at startup "
                    "and the prompt file exists."
                )
            return self._prompts[agent_name]

    def reload(self) -> dict[str, bool]:
        """Re-read every prompt file from disk. Returns {agent_name: success}."""
        from backend.agents_config_loader import get_agents_config

        cfg = get_agents_config()
        results: dict[str, bool] = {}
        with self._lock:
            for agent_name, agent_cfg in cfg.agents.items():
                results[agent_name] = self._load_one(agent_name, agent_cfg.prompt_file)
        log.info("prompts_reloaded", results=results)
        return results

    def loaded_agents(self) -> list[str]:
        with self._lock:
            return list(self._prompts.keys())


_manager = PromptManager()


def get_prompt_manager() -> PromptManager:
    return _manager


def reload_prompts() -> dict[str, bool]:
    return _manager.reload()
