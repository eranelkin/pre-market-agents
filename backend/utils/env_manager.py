import os
import re
from pathlib import Path


def _find_env_path() -> Path:
    """Walk up from CWD to find the nearest .env file. Creates at CWD if not found."""
    p = Path.cwd()
    for _ in range(6):
        candidate = p / ".env"
        if candidate.exists():
            return candidate
        p = p.parent
    return Path.cwd() / ".env"


def read_env_file() -> dict[str, str]:
    path = _find_env_path()
    if not path.exists():
        return {}
    result: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, val = line.partition("=")
            result[key.strip()] = val.strip().strip('"').strip("'")
    return result


def write_env_var(key: str, value: str) -> None:
    """Add or update a key=value line in .env and inject into the running process."""
    path = _find_env_path()
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    new_line = f"{key}={value}"
    updated = False
    for i, line in enumerate(lines):
        if re.match(rf"^{re.escape(key)}\s*=", line):
            lines[i] = new_line
            updated = True
            break
    if not updated:
        lines.append(new_line)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.environ[key] = value  # hot-inject without restart


def key_is_set(env_var_name: str) -> bool:
    if os.environ.get(env_var_name):
        return True
    return bool(read_env_file().get(env_var_name))
