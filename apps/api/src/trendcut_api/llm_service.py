import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4
import httpx
from sqlalchemy.orm import Session
from .models import LlmCall
from .prompt_registry import render_prompt
from .settings import get_settings


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def model_provider(model: str) -> str:
    if model.startswith('local-'):
        return 'local_template'
    if model.startswith('gemini'):
        return 'gemini'
    if model.startswith('deepseek'):
        return 'deepseek'
    if model.startswith('qwen'):
        return 'qwen'
    return 'openai_compatible'


def local_template_response(capability: str, user_prompt: str) -> dict[str, Any]:
    return {
        'mode': 'local_template',
        'capability': capability,
        'text': f'[{capability}] {user_prompt[:500]}',
        'structured': {
            'summary': user_prompt[:240],
            'needs_external_llm': True
        }
    }


async def call_litellm(model: str, system_prompt: str, user_prompt: str) -> dict[str, Any]:
    settings = get_settings()
    if not settings.litellm_base_url:
        raise RuntimeError('LITELLM_BASE_URL is not configured')

    headers = {'content-type': 'application/json'}
    if settings.litellm_api_key:
        headers['authorization'] = f'Bearer {settings.litellm_api_key}'

    payload = {
        'model': model,
        'messages': [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': user_prompt}
        ]
    }
    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.post(f"{settings.litellm_base_url.rstrip('/')}/chat/completions", json=payload, headers=headers)
        response.raise_for_status()
        body = response.json()
    choice = body.get('choices', [{}])[0].get('message', {}).get('content', '')
    return {
        'mode': 'litellm',
        'text': choice,
        'raw': body
    }


async def generate_ai(session: Session, capability: str, payload: dict[str, Any], task_id: str | None = None, preferred_models: list[str] | None = None) -> dict[str, Any]:
    prompt_version, system_prompt, user_prompt = render_prompt(capability, payload)
    settings = get_settings()
    models = preferred_models or [item.strip() for item in settings.llm_model_order.split(',') if item.strip()]
    trace_id = str(uuid4())
    last_error: dict[str, Any] | None = None

    for model in models:
        started = time.perf_counter()
        provider = model_provider(model)
        status = 'succeeded'
        error = None
        response_payload = None
        try:
            if provider == 'local_template':
                response_payload = local_template_response(capability, user_prompt)
            else:
                response_payload = await call_litellm(model, system_prompt, user_prompt)
        except Exception as exc:
            status = 'failed'
            error = {'message': str(exc), 'model': model, 'provider': provider}
            last_error = error

        latency_ms = int((time.perf_counter() - started) * 1000)
        output_text = '' if response_payload is None else str(response_payload.get('text', ''))
        call = LlmCall(
            id=str(uuid4()),
            task_id=task_id,
            capability=capability,
            prompt_version=prompt_version,
            provider=provider,
            model=model,
            input_tokens=estimate_tokens(system_prompt + user_prompt),
            output_tokens=estimate_tokens(output_text) if output_text else 0,
            cost=0,
            latency_ms=latency_ms,
            trace_id=trace_id,
            status=status,
            error=error,
            request={
                'capability': capability,
                'prompt_version': prompt_version,
                'model': model,
                'input': payload
            },
            response=response_payload,
            created_at=datetime.now(timezone.utc)
        )
        session.add(call)
        session.commit()

        if response_payload is not None:
            return {
                'trace_id': trace_id,
                'capability': capability,
                'prompt_version': prompt_version,
                'provider': provider,
                'model': model,
                'response': response_payload,
                'fallback_used': model != models[0]
            }

    return {
        'trace_id': trace_id,
        'capability': capability,
        'prompt_version': prompt_version,
        'provider': 'none',
        'model': None,
        'response': None,
        'fallback_used': True,
        'error': last_error or {'message': 'No model attempted'}
    }
