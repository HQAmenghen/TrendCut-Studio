import os
import re
from pathlib import Path


def load_project_env(start_file: str | None = None) -> Path:
    current = Path(start_file or __file__).resolve()
    search_roots = [current.parent, *current.parents]

    env_path = None
    for candidate_root in search_roots:
        candidate = candidate_root / ".env"
        if candidate.exists():
            env_path = candidate
            break

    if env_path is None:
        return current.parent

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        else:
            value = re.sub(r"\s+#.*$", "", value).strip()
        os.environ[key] = value

    return env_path.parent
