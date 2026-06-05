TOOL_REGISTRY = {
    'ai.generate': {
        'risk': 'low',
        'requires_confirmation': False,
        'description': 'Run governed AI generation through the FastAPI AI control plane.'
    },
    'task.read': {
        'risk': 'low',
        'requires_confirmation': False,
        'description': 'Read canonical task state.'
    },
    'publish.execute': {
        'risk': 'high',
        'requires_confirmation': True,
        'description': 'Execute a platform publish action. Worker implementation arrives in Phase 6.'
    },
    'file.delete': {
        'risk': 'high',
        'requires_confirmation': True,
        'description': 'Delete files. Worker/tool implementation arrives after permission hardening.'
    }
}


def get_tool(name: str) -> dict | None:
    return TOOL_REGISTRY.get(name)
