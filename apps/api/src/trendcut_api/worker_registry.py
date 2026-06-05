WORKER_TYPES: dict[str, dict] = {
    'asr_worker': {
        'queue': 'video',
        'risk': 'low',
        'description': 'Run ASR over uploaded source media and emit transcript artifacts.'
    },
    'material_score_worker': {
        'queue': 'video',
        'risk': 'low',
        'description': 'Score candidate material segments for downstream script and clip planning.'
    },
    'script_worker': {
        'queue': 'video',
        'risk': 'low',
        'description': 'Generate or polish structured scripts for a material-driven task.'
    },
    'clip_plan_worker': {
        'queue': 'video',
        'risk': 'low',
        'description': 'Build a structured clip plan from source material and script state.'
    },
    'render_worker': {
        'queue': 'video',
        'risk': 'medium',
        'description': 'Render video output through FFmpeg, ComfyUI, RunningHub, or local adapters.'
    },
    'review_worker': {
        'queue': 'video',
        'risk': 'low',
        'description': 'Review generated video artifacts and produce structured findings.'
    },
    'publish_worker': {
        'queue': 'publish',
        'risk': 'high',
        'requires_confirmation': True,
        'description': 'Publish approved assets. Phase 6 owns the RPA executor.'
    },
    'rpa_worker': {
        'queue': 'rpa',
        'risk': 'high',
        'requires_confirmation': True,
        'description': 'Run browser automation. Phase 6 owns account state and audit hardening.'
    }
}


def get_worker_type(job_type: str) -> dict | None:
    return WORKER_TYPES.get(job_type)
