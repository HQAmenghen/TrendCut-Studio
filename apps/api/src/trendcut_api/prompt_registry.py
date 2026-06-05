import json
from functools import lru_cache
from pathlib import Path
from typing import Any


@lru_cache
def load_prompt_registry() -> dict[str, dict[str, str]]:
    registry_path = Path(__file__).resolve().parent / 'prompts' / 'registry.json'
    return json.loads(registry_path.read_text(encoding='utf-8'))


def render_prompt(capability: str, payload: dict[str, Any]) -> tuple[str, str, str]:
    registry = load_prompt_registry()
    if capability not in registry:
        raise KeyError(f'Unknown prompt capability: {capability}')
    prompt = registry[capability]
    input_text = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return prompt['version'], prompt['system'], prompt['template'].format(input=input_text)
