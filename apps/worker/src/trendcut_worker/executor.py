from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import urllib.request
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LEGACY_ENTRYPOINTS = {
    'asr_worker': 'python/pipeline/run_asr.py',
    'material_score_worker': 'python/pipeline/score_material_segments.py',
    'script_worker': 'python/pipeline/skills/script_rewriter_skill.py',
    'material_driven_worker': 'python/pipeline/run_material_driven.py',
    'clip_plan_worker': 'python/pipeline/skills/clip_selector.py',
    'render_worker': 'python/pipeline/make_vertical_video.py',
    'review_worker': 'python/review/ai_video_review.py',
    'xai_worker': 'python/xai/run_xai_top10.py',
    'publish_worker': 'python/publish/social_auto_upload_adapter.py',
    'rpa_worker': 'python/publish/browser_platform_rpa.py'
}

HIGH_RISK_JOB_TYPES = {'publish_worker', 'rpa_worker'}
PROTOCOL_PREFIX = '__CODEX_PYTHON__'
PROTOCOL_VERSION = 'jsonl-v1'


def execute_job(job: dict[str, Any], artifact_root: Path) -> dict[str, Any]:
    job_type = str(job['job_type'])
    payload = dict(job.get('payload') or {})
    if job_type not in LEGACY_ENTRYPOINTS:
        raise ValueError(f'Unsupported worker job type: {job_type}')
    if job_type in HIGH_RISK_JOB_TYPES and payload.get('confirmed') is not True:
        raise PermissionError(f'{job_type} requires confirmed=true')
    payload.setdefault('artifact_workspace', str(artifact_root / str(job['task_id']) / f"{job['id']}-{job_type}-workspace"))

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
    if job_type == 'asr_worker':
        return _execute_asr_worker(payload)
    if job_type == 'material_score_worker':
        return _execute_material_score_worker(payload)
    if job_type == 'script_worker':
        return _execute_script_worker(payload)
    if job_type == 'material_driven_worker':
        return _execute_material_driven_worker(payload)
    if job_type == 'clip_plan_worker':
        return _execute_clip_plan_worker(payload)
    if job_type == 'render_worker':
        return _execute_render_worker(payload)
    if job_type == 'review_worker':
        return _execute_review_worker(payload)
    if job_type == 'xai_worker':
        return _execute_xai_worker(payload)
    if job_type == 'publish_worker':
        return _execute_publish_worker(payload)
    if job_type == 'rpa_worker':
        return _execute_rpa_worker(payload)
    return {
        'executor': 'trendcut_worker.adapter',
        'structured_output': _structured_output(job_type, payload)
    }


def _project_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _python_root() -> Path:
    return _project_root() / 'python'


def _ensure_python_path() -> None:
    python_root = _python_root()
    if str(python_root) not in sys.path:
        sys.path.insert(0, str(python_root))


def _workspace(payload: dict[str, Any], name: str) -> Path:
    explicit = str(payload.get('workdir') or payload.get('workspace') or '').strip()
    if explicit:
        path = Path(explicit).resolve()
    else:
        path = Path(payload.get('artifact_workspace') or '').resolve() if payload.get('artifact_workspace') else Path.cwd() / 'data' / 'worker-workspaces' / name
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_json(path: Path, data: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    return path


def _copy_or_write_json(payload: dict[str, Any], key: str, fallback_name: str, workspace: Path, default: Any) -> Path:
    source_path = payload.get(f'{key}_path')
    if source_path:
        target = workspace / fallback_name
        shutil.copy2(Path(str(source_path)).resolve(), target)
        return target
    return _write_json(workspace / fallback_name, payload.get(key, default))


def _required_path(payload: dict[str, Any], *keys: str) -> Path:
    for key in keys:
        value = str(payload.get(key) or '').strip()
        if value:
            path = Path(value).resolve()
            if not path.exists():
                raise FileNotFoundError(f'{key} not found: {path}')
            return path
    raise ValueError(f'Missing required path: {"/".join(keys)}')


def _material_input_path(payload: dict[str, Any], workspace: Path) -> Path:
    for key in ('material_path', 'input', 'input_video', 'source_path', 'video_path'):
        value = str(payload.get(key) or '').strip()
        if value:
            path = Path(value).resolve()
            if not path.exists():
                raise FileNotFoundError(f'{key} not found: {path}')
            return path
    material_url = str(payload.get('material_url') or payload.get('video_url') or '').strip()
    if material_url:
        target = workspace / 'material.mp4'
        with urllib.request.urlopen(material_url, timeout=120) as response:
            target.write_bytes(response.read())
        return target
    raise ValueError('Missing material_path or material_url')


def _run_python(script: str, args: list[str], cwd: Path, timeout_seconds: int = 900) -> dict[str, Any]:
    project_root = _project_root()
    env = {
        **os.environ,
        'CODEX_PYTHON_PROTOCOL': PROTOCOL_VERSION,
        'PYTHONIOENCODING': 'utf-8',
        'PYTHONPATH': os.pathsep.join([str(_python_root()), str(project_root), os.environ.get('PYTHONPATH', '')])
    }
    command = [sys.executable, str(project_root / script), *args]
    completed = subprocess.run(
        command,
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        encoding='utf-8',
        errors='replace',
        timeout=timeout_seconds
    )
    events = _parse_protocol_events(completed.stdout)
    if completed.returncode != 0:
        error_event = next((event for event in reversed(events) if event.get('type') == 'error'), None)
        message = error_event.get('message') if error_event else (completed.stderr or completed.stdout or 'legacy script failed')
        raise RuntimeError(str(message).strip())
    return {
        'command': command,
        'cwd': str(cwd),
        'stdout_tail': _tail(completed.stdout),
        'stderr_tail': _tail(completed.stderr),
        'protocol_events': events
    }


def _parse_protocol_events(stdout: str) -> list[dict[str, Any]]:
    events = []
    for line in str(stdout or '').splitlines():
        if not line.startswith(PROTOCOL_PREFIX):
            continue
        try:
            event = json.loads(line[len(PROTOCOL_PREFIX):])
            if isinstance(event, dict):
                events.append(event)
        except Exception:
            continue
    return events


def _tail(text: str, limit: int = 40) -> str:
    return '\n'.join(str(text or '').splitlines()[-limit:])


def _execute_asr_worker(payload: dict[str, Any]) -> dict[str, Any]:
    workspace = _workspace(payload, 'asr_worker')
    input_video = _required_path(payload, 'input', 'input_video', 'source_path', 'video_path')
    audio_json = workspace / str(payload.get('audio_json_name') or 'audio.json')
    subtitles_json = workspace / str(payload.get('subtitles_json_name') or 'subtitles.json')
    speaker_scene_json = workspace / str(payload.get('speaker_scene_json_name') or 'speaker_scene.json')
    args = [
        '--input', str(input_video),
        '--audio-json', str(audio_json),
        '--subtitles-json', str(subtitles_json),
        '--speaker-scene-json', str(speaker_scene_json)
    ]
    if payload.get('allow_no_audio') is True:
        args.append('--allow-no-audio')
    if payload.get('translate_subtitles') is True:
        args.append('--translate-subtitles')
    if payload.get('refine_subtitles') is True:
        args.append('--refine-subtitles')
    if payload.get('reference_text_authority') is True:
        args.append('--reference-text-authority')
    if payload.get('reference_subtitles_path'):
        args.extend(['--reference-subtitles-json', str(Path(str(payload['reference_subtitles_path'])).resolve())])
    run = _run_python('python/pipeline/run_asr.py', args, workspace, int(payload.get('timeout_seconds') or 1800))
    return {
        'executor': 'trendcut_worker.legacy.asr_worker',
        'structured_output': {
            'audio': _read_json(audio_json, []),
            'subtitles': _read_json(subtitles_json, []),
            'speaker_scene': _read_json(speaker_scene_json, []),
            'files': {
                'audio_json': str(audio_json),
                'subtitles_json': str(subtitles_json),
                'speaker_scene_json': str(speaker_scene_json)
            },
            'run': run
        }
    }


def _execute_material_score_worker(payload: dict[str, Any]) -> dict[str, Any]:
    workspace = _workspace(payload, 'material_score_worker')
    _copy_or_write_json(payload, 'material_segments', 'material_segments.json', workspace, {'segments': payload.get('segments', [])})
    run = _run_python('python/pipeline/score_material_segments.py', [], workspace, int(payload.get('timeout_seconds') or 1800))
    output_path = workspace / 'material_segments_scored.json'
    return {
        'executor': 'trendcut_worker.legacy.material_score_worker',
        'structured_output': {
            'scored_segments': _read_json(output_path, {}),
            'files': {'scored_segments_json': str(output_path)},
            'run': run
        }
    }


def _execute_script_worker(payload: dict[str, Any]) -> dict[str, Any]:
    _ensure_python_path()

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


def _execute_material_driven_worker(payload: dict[str, Any]) -> dict[str, Any]:
    workspace = _workspace(payload, 'material_driven_worker')
    material_path = _material_input_path(payload, workspace)
    source_post = payload.get('source_post')
    if isinstance(source_post, dict):
        _write_json(workspace / 'source_post.json', source_post)
    manual_script = str(payload.get('manual_script') or '').strip()
    if manual_script:
        (workspace / 'manual_narration.txt').write_text(manual_script, encoding='utf-8')
    args = ['--output-dir', str(workspace)]
    if payload.get('use_smart_clip') is False:
        args.append('--no-smart-clip')
    if payload.get('use_cache') is True:
        args.append('--use-cache')
    if payload.get('allow_rule_fallback') is True:
        args.append('--allow-rule-fallback')
    if payload.get('start_from'):
        args.extend(['--start-from', str(payload['start_from'])])
    if payload.get('end_at'):
        args.extend(['--end-at', str(payload['end_at'])])
    args.append(str(material_path))
    run = _run_python('python/pipeline/run_material_driven.py', args, workspace, int(payload.get('timeout_seconds') or 7200))
    output_path = workspace / 'output_final.mp4'
    return {
        'executor': 'trendcut_worker.legacy.material_driven_worker',
        'structured_output': {
            'output_dir': str(workspace),
            'output_video': str(output_path),
            'exists': output_path.exists(),
            'files': {
                'output_dir': str(workspace),
                'output_video': str(output_path),
                'source_post_json': str(workspace / 'source_post.json')
            },
            'run': run
        }
    }


def _execute_clip_plan_worker(payload: dict[str, Any]) -> dict[str, Any]:
    _ensure_python_path()

    from pipeline.skills.clip_selector import ClipSelectorSkill

    skill_result = ClipSelectorSkill().run(payload)
    serialized = asdict(skill_result) if is_dataclass(skill_result) else {
        'skill': getattr(skill_result, 'skill', 'clip_selector'),
        'version': getattr(skill_result, 'version', 'unknown'),
        'output': getattr(skill_result, 'output', {}),
        'meta': getattr(skill_result, 'meta', {})
    }
    return {
        'executor': 'trendcut_worker.legacy.clip_plan_worker',
        'structured_output': {
            'clip_plan': serialized.get('output', {}),
            'legacy_skill': serialized.get('skill'),
            'legacy_version': serialized.get('version'),
            'legacy_meta': serialized.get('meta', {})
        }
    }


def _execute_xai_worker(payload: dict[str, Any]) -> dict[str, Any]:
    workspace = _workspace(payload, 'xai_worker')
    result_path = workspace / 'result.json'
    partial_path = workspace / 'result.partial.json'
    log_path = workspace / 'run_log.txt'
    error_log_path = workspace / 'run_error.log'
    args = [
        '--partition-id', str(payload.get('partition_id') or payload.get('partitionId') or 'crypto'),
        '--result', str(result_path),
        '--partial', str(partial_path),
        '--log', str(log_path),
        '--error-log', str(error_log_path)
    ]
    import_url = str(payload.get('import_url') or payload.get('url') or '').strip()
    if import_url:
        args.extend(['--import-url', import_url])
    run = _run_python('python/xai/run_xai_top10.py', args, workspace, int(payload.get('timeout_seconds') or 3600))
    return {
        'executor': 'trendcut_worker.legacy.xai_worker',
        'structured_output': {
            'result': _read_json(result_path, {}),
            'files': {
                'result_json': str(result_path),
                'partial_json': str(partial_path),
                'log': str(log_path),
                'error_log': str(error_log_path)
            },
            'run': run
        }
    }


def _execute_render_worker(payload: dict[str, Any]) -> dict[str, Any]:
    workspace = _workspace(payload, 'render_worker')
    input_video = _required_path(payload, 'input', 'input_video', 'source_path', 'video_path')
    content_path = _copy_or_write_json(payload, 'content', 'content.json', workspace, payload.get('metadata', {}))
    subtitles_path = _copy_or_write_json(payload, 'subtitles', 'subtitles.json', workspace, [])
    output_path = workspace / str(payload.get('output_name') or 'output_9x16.mp4')
    args = [
        '--input', str(input_video),
        '--content', str(content_path),
        '--subtitles', str(subtitles_path),
        '--output', str(output_path)
    ]
    if payload.get('outro_path'):
        args.extend(['--outro', str(Path(str(payload['outro_path'])).resolve())])
    if payload.get('split_long_subtitles') is True:
        args.append('--split-long-subtitles')
    run = _run_python('python/pipeline/make_vertical_video.py', args, workspace, int(payload.get('timeout_seconds') or 3600))
    return {
        'executor': 'trendcut_worker.legacy.render_worker',
        'structured_output': {
            'output_video': str(output_path),
            'exists': output_path.exists(),
            'files': {
                'content_json': str(content_path),
                'subtitles_json': str(subtitles_path),
                'output_video': str(output_path)
            },
            'run': run
        }
    }


def _execute_review_worker(payload: dict[str, Any]) -> dict[str, Any]:
    workspace = _workspace(payload, 'review_worker')
    video_path = _required_path(payload, 'video', 'video_path', 'input_video', 'source_path')
    metadata_path = _copy_or_write_json(payload, 'metadata', 'metadata.json', workspace, {})
    output_path = workspace / str(payload.get('output_name') or 'review_result.json')
    args = ['--video', str(video_path), '--metadata', str(metadata_path), '--output', str(output_path)]
    if payload.get('config') or payload.get('config_path'):
        config_path = _copy_or_write_json(payload, 'config', 'review_config.json', workspace, {})
        args.extend(['--config', str(config_path)])
    run = _run_python('python/review/ai_video_review.py', args, workspace, int(payload.get('timeout_seconds') or 3600))
    return {
        'executor': 'trendcut_worker.legacy.review_worker',
        'structured_output': {
            'review': _read_json(output_path, {}),
            'files': {'review_result_json': str(output_path)},
            'run': run
        }
    }


def _execute_publish_worker(payload: dict[str, Any]) -> dict[str, Any]:
    workspace = _workspace(payload, 'publish_worker')
    payload_path = _write_json(workspace / 'publish_payload.json', payload)
    args = ['--payload', str(payload_path)]
    if payload.get('social_auto_upload_dir'):
        args.extend(['--social-auto-upload-dir', str(payload['social_auto_upload_dir'])])
    if payload.get('runtime_dir'):
        args.extend(['--runtime-dir', str(payload['runtime_dir'])])
    run = _run_python('python/publish/social_auto_upload_adapter.py', args, workspace, int(payload.get('timeout_seconds') or 7200))
    return {
        'executor': 'trendcut_worker.legacy.publish_worker',
        'structured_output': {
            'platform': payload.get('platform'),
            'publish_status': 'completed',
            'payload_json': str(payload_path),
            'run': run
        }
    }


def _execute_rpa_worker(payload: dict[str, Any]) -> dict[str, Any]:
    workspace = _workspace(payload, 'rpa_worker')
    payload_path = _write_json(workspace / 'rpa_payload.json', payload)
    run = _run_python('python/publish/browser_platform_rpa.py', ['--payload', str(payload_path)], workspace, int(payload.get('timeout_seconds') or 7200))
    return {
        'executor': 'trendcut_worker.legacy.rpa_worker',
        'structured_output': {
            'platform': payload.get('platform'),
            'rpa_status': 'completed',
            'payload_json': str(payload_path),
            'run': run
        }
    }


def _read_json(path: Path, default: Any) -> Any:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return default
    return default


def _structured_output(job_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    source = payload.get('source') or payload.get('source_path') or payload.get('material_url')
    if job_type == 'asr_worker':
        return {'transcript': payload.get('transcript', ''), 'source': source}
    if job_type == 'material_score_worker':
        return {'segments': payload.get('segments', []), 'score_threshold': payload.get('score_threshold')}
    if job_type == 'script_worker':
        return {'script': payload.get('script', ''), 'version': payload.get('script_version', 'adapter-v1')}
    if job_type == 'material_driven_worker':
        return {'output_dir': payload.get('workdir'), 'output_video': payload.get('output_video')}
    if job_type == 'clip_plan_worker':
        return {'clips': payload.get('clips', []), 'strategy': payload.get('strategy', 'material-driven')}
    if job_type == 'render_worker':
        return {'output_video': payload.get('output_video'), 'render_provider': payload.get('render_provider', 'adapter')}
    if job_type == 'review_worker':
        return {'approved': payload.get('approved', True), 'findings': payload.get('findings', [])}
    if job_type == 'xai_worker':
        return {'result': payload.get('result', {})}
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
