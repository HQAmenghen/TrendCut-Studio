"""Qwen3-TTS voice cloning and non-streaming speech synthesis."""

from __future__ import annotations

import argparse
import base64
import mimetypes
import os
import pathlib
import re
import sys
from http import HTTPStatus
from urllib.parse import urlparse

import dashscope
import requests

PYTHON_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

from load_env import load_project_env
from script_protocol import emit_result, emit_stage, run_guarded


DEFAULT_TARGET_MODEL = "qwen3-tts-vc-2026-01-22"
DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/api/v1"
DEFAULT_PREFERRED_NAME = "comfyavatar"
DEFAULT_TIMEOUT_SECONDS = 180
PREFERRED_NAME_PATTERN = re.compile(r"[^A-Za-z0-9]+")


def normalize_base_url(base_url: str) -> str:
    normalized = (base_url or DEFAULT_BASE_URL).strip().rstrip("/")
    if normalized.endswith("/compatible-mode/v1"):
        return normalized[: -len("/compatible-mode/v1")] + "/api/v1"
    if normalized.endswith("/compatible-mode"):
        return normalized[: -len("/compatible-mode")] + "/api/v1"
    if normalized.endswith("/v1") and not normalized.endswith("/api/v1"):
        return normalized[: -len("/v1")] + "/api/v1"
    return normalized


def normalize_preferred_name(preferred_name: str) -> str:
    cleaned = PREFERRED_NAME_PATTERN.sub("", str(preferred_name or "").strip())
    if not cleaned:
        return DEFAULT_PREFERRED_NAME
    if cleaned[0].isdigit():
        cleaned = f"voice{cleaned}"
    return cleaned[:16]


def get_api_key() -> str:
    raw_key = os.getenv("QWEN_API_KEY") or os.getenv("DASHSCOPE_API_KEY")
    if not raw_key:
        raise RuntimeError("Missing Qwen API key. Set QWEN_API_KEY or DASHSCOPE_API_KEY.")
    for separator in (";", ","):
        if separator in raw_key:
            return next(item.strip() for item in raw_key.split(separator) if item.strip())
    return raw_key.strip()


def customization_url(base_url: str) -> str:
    return f"{normalize_base_url(base_url)}/services/audio/tts/customization"


def guess_audio_mime_type(file_path: pathlib.Path) -> str:
    guessed, _encoding = mimetypes.guess_type(str(file_path))
    return guessed or "audio/mpeg"


def create_voice(
    file_path: pathlib.Path,
    *,
    api_key: str,
    base_url: str,
    target_model: str,
    preferred_name: str,
    timeout: int,
) -> str:
    if not file_path.exists():
        raise FileNotFoundError(f"音频文件不存在: {file_path}")

    mime_type = guess_audio_mime_type(file_path)
    data_uri = f"data:{mime_type};base64,{base64.b64encode(file_path.read_bytes()).decode()}"
    payload = {
        "model": "qwen-voice-enrollment",
        "input": {
            "action": "create",
            "target_model": target_model,
            "preferred_name": preferred_name,
            "audio": {"data": data_uri},
        },
    }
    response = requests.post(
        customization_url(base_url),
        json=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        timeout=timeout,
    )
    if response.status_code != 200:
        raise RuntimeError(f"创建 voice 失败: {response.status_code}, {response.text}")
    try:
        voice = response.json()["output"]["voice"]
    except (KeyError, ValueError) as exc:
        raise RuntimeError(f"解析 voice 响应失败: {exc}") from exc
    if not voice:
        raise RuntimeError("创建 voice 响应为空")
    return str(voice)


def response_to_dict(response) -> dict:
    if isinstance(response, dict):
        return response
    if hasattr(response, "to_dict"):
        return response.to_dict()
    result = {}
    for key in ("status_code", "code", "message", "request_id", "output"):
        if hasattr(response, key):
            result[key] = getattr(response, key)
    return result


def nested_get(payload, *keys):
    current = payload
    for key in keys:
        if isinstance(current, dict):
            current = current.get(key)
        else:
            current = getattr(current, key, None)
        if current is None:
            return None
    return current


def extract_audio_url(response) -> str:
    status_code = nested_get(response, "status_code")
    if status_code is not None and int(status_code) != HTTPStatus.OK:
        code = nested_get(response, "code") or ""
        message = nested_get(response, "message") or ""
        raise RuntimeError(f"语音合成失败: {status_code} {code} {message}".strip())

    payload = response_to_dict(response)
    candidates = [
        nested_get(payload, "output", "audio", "url"),
        nested_get(payload, "output", "url"),
        nested_get(response, "output", "audio", "url"),
        nested_get(response, "output", "url"),
    ]
    for candidate in candidates:
        if candidate:
            return str(candidate)
    raise RuntimeError(f"语音合成响应中未找到音频 URL: {payload}")


def download_audio(audio_url: str, output_path: pathlib.Path, *, timeout: int) -> int:
    parsed = urlparse(audio_url)
    if parsed.scheme not in {"http", "https"}:
        raise RuntimeError(f"语音合成返回了不支持的音频 URL: {audio_url}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_suffix(output_path.suffix + ".tmp")
    with requests.get(audio_url, stream=True, timeout=timeout) as response:
        response.raise_for_status()
        with tmp_path.open("wb") as file_obj:
            for chunk in response.iter_content(chunk_size=1024 * 256):
                if chunk:
                    file_obj.write(chunk)
    if tmp_path.stat().st_size <= 0:
        tmp_path.unlink(missing_ok=True)
        raise RuntimeError("下载的 Qwen3TTS 音频为空")
    tmp_path.replace(output_path)
    return output_path.stat().st_size


def synthesize_speech(
    *,
    api_key: str,
    base_url: str,
    model: str,
    text: str,
    voice: str,
    language_type: str,
):
    dashscope.base_http_api_url = normalize_base_url(base_url)
    kwargs = {
        "model": model,
        "api_key": api_key,
        "text": text,
        "voice": voice,
        "stream": False,
    }
    if language_type:
        kwargs["language_type"] = language_type
    return dashscope.MultiModalConversation.call(**kwargs)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Clone a Qwen3TTS voice and synthesize narration audio.")
    parser.add_argument("--text", required=True)
    parser.add_argument("--reference-audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default=os.getenv("QWEN_TTS_MODEL", DEFAULT_TARGET_MODEL))
    parser.add_argument("--preferred-name", default=os.getenv("QWEN_TTS_PREFERRED_NAME", DEFAULT_PREFERRED_NAME))
    parser.add_argument("--base-url", default=os.getenv("QWEN_TTS_BASE_URL") or os.getenv("QWEN_API_BASE_URL") or DEFAULT_BASE_URL)
    parser.add_argument("--language-type", default=os.getenv("QWEN_TTS_LANGUAGE_TYPE", ""))
    parser.add_argument("--timeout", type=int, default=int(os.getenv("QWEN_TTS_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS)))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    load_project_env(__file__)
    args = parse_args(argv)
    text = str(args.text or "").strip()
    if not text:
        raise RuntimeError("缺少可用口播文案")

    api_key = get_api_key()
    reference_audio = pathlib.Path(args.reference_audio).resolve()
    output_path = pathlib.Path(args.output).resolve()
    model = str(args.model or DEFAULT_TARGET_MODEL).strip()
    base_url = normalize_base_url(str(args.base_url or DEFAULT_BASE_URL))

    emit_stage("qwen_tts_voice", "正在使用 Qwen3TTS 创建复刻音色")
    voice = create_voice(
        reference_audio,
        api_key=api_key,
        base_url=base_url,
        target_model=model,
        preferred_name=normalize_preferred_name(args.preferred_name),
        timeout=int(args.timeout),
    )

    emit_stage("qwen_tts_synthesize", "正在使用复刻音色合成口播音频")
    response = synthesize_speech(
        api_key=api_key,
        base_url=base_url,
        model=model,
        text=text,
        voice=voice,
        language_type=str(args.language_type or "").strip(),
    )
    audio_url = extract_audio_url(response)

    emit_stage("qwen_tts_download", "正在下载 Qwen3TTS 合成音频")
    file_size = download_audio(audio_url, output_path, timeout=int(args.timeout))
    emit_result(
        "Qwen3TTS 口播音频生成完成",
        outputPath=str(output_path),
        voice=voice,
        model=model,
        audioUrl=audio_url,
        fileSize=file_size,
    )
    return 0


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="QWEN_TTS_FAILED",
        error_message="Qwen3TTS 口播音频生成失败",
        error_stage="qwen_tts",
        hint="请检查 QWEN_API_KEY/DASHSCOPE_API_KEY、QWEN_TTS_MODEL 与声音复刻 target_model 是否一致。",
    ))
