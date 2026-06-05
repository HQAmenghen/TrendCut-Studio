from __future__ import annotations

import json
import sys
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LEGACY_ENTRYPOINTS = {
    'asr_worker': 'python/pipeline/run_asr.py',
    'material_score_worker': 'python/pipeline/score_material_segments.py',
    'script_worker': 'python/pipeline/skills/script_rewriter_skill.py',
    'clip_plan_worker': 'python/pipeline/skills/clip_selector.py',
    'render_worker': 'python/pipeline/make_vertical_video.py',
    'review_worker': 'python/review/ai_video_review.py',
    'publish_worker': 'python/publish/social_auto_upload_adapter.py',
    'rpa_worker': 'python/publish/browser_platform_rpa.py'
}

HIGH_RISK_JOB_TYPES = {'publish_worker', 'rpa_worker'}


def execute_job(job: dict[str, Any], artifact_root: Path) -> dict[str, Any]:
    job_type = str(job['job_type'])
    payload = job.get('payload') or {}
    if job_type not in LEGACY_ENTRYPOINTS:
        raise ValueError(f'Unsupported worker job type: {job_type}')
    if job_type in HIGH_RISK_JOB_TYPES and payload.get('confirmed') is not True:
        raise PermissionError(f'{job_type} requires confirmed=true')

    now = datetime.now(timezone.utc).isoformat()
    legacy_output = _execute_legacy(job_type, payload)
    result = {
        'job_type': job_type,
        'status': 'succeeded',
        'executor': legacy_output.get('executor', 'trendcut_worker.adapter'),
        'legacy_entrypoint': LEGACY_ENTRYPOINTS[job_type],
        'structured_output': legacy_output.get('structured_output', _structured_output(job_type, payload)),
        'completed_at': now
    }
    manifest_path = _write_manifest(job, result, artifact_root)
    artifact_type = 'video_manifest' if job_type == 'render_worker' else 'worker_manifest'
    return {
        'result': result,
        'artifacts': [{
            'type': artifact_type,
            'path': str(manifest_path),
            'mime_type': 'application/json',
            'metadata': {
                'job_type': job_type,
                'executor': result['executor'],
                'created_at': now
            }
        }]
    }


def _execute_legacy(job_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    if job_type == 'script_worker':
        return _execute_script_worker(payload)
    return {
        'executor': 'trendcut_worker.adapter',
        'structured_output': _structured_output(job_type, payload)
    }


def _execute_script_worker(payload: dict[str, Any]) -> dict[str, Any]:
    project_root = Path(__file__).resolve().parents[4]
    python_root = project_root / 'python'
    if str(python_root) not in sys.path:
        sys.path.insert(0, str(python_root))

    from pipeline.skills.script_rewriter_skill import ScriptRewriterSkill

    skill_result = ScriptRewriterSkill().run(payload)
    if is_dataclass(skill_result):
        serialized = asdict(skill_result)
    else:
        serialized = {
            'skill': getattr(skill_result, 'skill', 'script_rewriter_skill'),
            'version': getattr(skill_result, 'version', 'unknown'),
            'output': getattr(skill_result, 'output', {}),
            'meta': getattr(skill_result, 'meta', {})
        }
    return {
        'executor': 'trendcut_worker.legacy.script_worker',
        'structured_output': {
            'script': serialized.get('output', {}),
            'legacy_skill': serialized.get('skill'),
            'legacy_version': serialized.get('version'),
            'legacy_meta': serialized.get('meta', {})
        }
    }


def _structured_output(job_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    source = payload.get('source') or payload.get('source_path') or payload.get('material_url')
    if job_type == 'asr_worker':
        return {'transcript': payload.get('transcript', ''), 'source': source}
    if job_type == 'material_score_worker':
        return {'segments': payload.get('segments', []), 'score_threshold': payload.get('score_threshold')}
    if job_type == 'script_worker':
        return {'script': payload.get('script', ''), 'version': payload.get('script_version', 'adapter-v1')}
    if job_type == 'clip_plan_worker':
        return {'clips': payload.get('clips', []), 'strategy': payload.get('strategy', 'material-driven')}
    if job_type == 'render_worker':
        return {'output_video': payload.get('output_video'), 'render_provider': payload.get('render_provider', 'adapter')}
    if job_type == 'review_worker':
        return {'approved': payload.get('approved', True), 'findings': payload.get('findings', [])}
    if job_type == 'publish_worker':
        return {'platform': payload.get('platform'), 'publish_status': 'deferred_to_phase_6_executor'}
    if job_type == 'rpa_worker':
        return {'platform': payload.get('platform'), 'rpa_status': 'deferred_to_phase_6_executor'}
    return {}


def _write_manifest(job: dict[str, Any], result: dict[str, Any], artifact_root: Path) -> Path:
    task_id = str(job['task_id'])
    job_id = str(job['id'])
    job_type = str(job['job_type'])
    target_dir = artifact_root / task_id
    target_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = target_dir / f'{job_id}-{job_type}.json'
    manifest_path.write_text(json.dumps({'job': job, 'result': result}, ensure_ascii=False, indent=2), encoding='utf-8')
    return manifest_path
