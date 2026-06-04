"""Qwen Filetrans and OSS upload helpers for ASR."""
import os
import re
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

import requests


DEFAULT_QWEN_ASR_MODEL = "qwen3-asr-flash-filetrans"
LEGACY_QWEN_ASR_MODEL = "qwen3-asr-flash"
QWEN_FILETRANS_TASK_TIMEOUT_SECONDS = 900
QWEN_FILETRANS_POLL_SECONDS = 5


def get_qwen_asr_model():
    return os.getenv("QWEN_ASR_MODEL", DEFAULT_QWEN_ASR_MODEL).strip() or DEFAULT_QWEN_ASR_MODEL


def get_qwen_asr_api_base_url():
    return os.getenv("QWEN_ASR_API_BASE_URL", os.getenv("DASHSCOPE_API_BASE_URL", "https://dashscope.aliyuncs.com/api/v1")).rstrip("/")


def is_public_http_url(value):
    parsed = urlparse(str(value or "").strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False
    hostname = (parsed.hostname or "").strip().lower()
    if (
        hostname in {"localhost", "0.0.0.0", "::1"}
        or hostname.startswith("127.")
        or hostname.startswith("10.")
        or hostname.startswith("192.168.")
    ):
        return False
    private_172 = re.match(r"^172\.(\d+)\.", hostname)
    if private_172 and 16 <= int(private_172.group(1)) <= 31:
        return False
    return True


def is_truthy_env(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def normalize_oss_prefix(prefix):
    normalized = str(prefix or "").strip().lstrip("/")
    if normalized and not normalized.endswith("/"):
        normalized += "/"
    return normalized


def get_oss_signed_url_expires_seconds():
    try:
        return max(60, int(float(os.getenv("ALIYUN_OSS_SIGNED_URL_EXPIRES_SECONDS", "86400"))))
    except (TypeError, ValueError):
        return 86400


def get_oss_filetrans_config():
    if not is_truthy_env("ALIYUN_OSS_ENABLED"):
        return None

    config = {
        "bucket": os.getenv("ALIYUN_OSS_BUCKET", "").strip(),
        "endpoint": os.getenv("ALIYUN_OSS_ENDPOINT", "").strip(),
        "access_key_id": os.getenv("ALIYUN_OSS_ACCESS_KEY_ID", "").strip(),
        "access_key_secret": os.getenv("ALIYUN_OSS_ACCESS_KEY_SECRET", "").strip(),
        "prefix": normalize_oss_prefix(os.getenv("ALIYUN_OSS_PREFIX", "comfy-panel/asr/")),
        "expires_seconds": get_oss_signed_url_expires_seconds(),
    }
    missing = [key for key in ("bucket", "endpoint", "access_key_id", "access_key_secret") if not config[key]]
    if missing:
        print(f"   ⚠️ 已启用 OSS ASR 上传但缺少配置: {', '.join(missing)}，将降级使用 qwen3-asr-flash。")
        return None
    return config


def make_oss_object_key(local_file, prefix=""):
    path = Path(local_file)
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", path.stem).strip("._-") or "audio"
    suffix = path.suffix or ".mp3"
    unique = uuid.uuid4().hex[:12]
    return f"{normalize_oss_prefix(prefix)}{int(time.time())}_{unique}_{stem}{suffix}"


def create_oss_bucket(config):
    try:
        import oss2
    except ImportError as exc:
        raise RuntimeError("未安装 oss2，无法将本地音频上传到阿里云 OSS。请先安装 requirements.txt。") from exc

    auth = oss2.Auth(config["access_key_id"], config["access_key_secret"])
    return oss2.Bucket(auth, config["endpoint"], config["bucket"])


def upload_filetrans_audio_to_oss(local_file, *, bucket_factory=create_oss_bucket):
    config = get_oss_filetrans_config()
    if not config:
        return "", None
    if not os.path.exists(local_file):
        raise FileNotFoundError(f"待上传的 ASR 音频不存在: {local_file}")

    object_key = make_oss_object_key(local_file, prefix=config["prefix"])
    bucket = bucket_factory(config)
    bucket.put_object_from_file(object_key, local_file)
    signed_url = bucket.sign_url("GET", object_key, config["expires_seconds"])
    if not is_public_http_url(signed_url):
        raise RuntimeError("OSS 未返回可用于 Filetrans 的公网签名 URL。")

    print(f"   -> 已上传 ASR 音频到 OSS: oss://{config['bucket']}/{object_key}")
    return signed_url, object_key


def resolve_filetrans_file_url(local_file, _file_url="", *, uploader=upload_filetrans_audio_to_oss):
    return uploader(local_file)


def fetch_json(url, headers=None):
    response = requests.get(url, headers=headers or {}, timeout=60)
    response.raise_for_status()
    return response.json()


def submit_qwen_filetrans_task(file_url, model):
    from qwen_client import (
        create_qwen_client,
        is_key_failover_error,
        is_retryable_error,
        mask_api_key,
    )

    client = create_qwen_client()
    base_url = get_qwen_asr_api_base_url()
    submit_url = f"{base_url}/services/audio/asr/transcription"
    payload = {
        "model": model,
        "input": {
            "file_url": file_url,
        },
        "parameters": {
            "enable_itn": True,
            "enable_words": True,
        },
    }
    attempts = max(1, client.key_count)
    last_error = None
    for attempt in range(1, attempts + 1):
        api_key = client.api_key
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
        }
        try:
            response = requests.post(submit_url, headers=headers, json=payload, timeout=60)
            response.raise_for_status()
            result = response.json()
            task_id = ((result.get("output") or {}).get("task_id") or result.get("task_id") or "").strip()
            if not task_id:
                raise RuntimeError(f"Filetrans 未返回 task_id: {result}")
            return task_id, headers
        except Exception as exc:
            last_error = exc
            if is_key_failover_error(exc):
                client.mark_key_unavailable(api_key)
            if attempt >= attempts or not is_retryable_error(exc):
                raise
            print(
                f"   ⚠️ Filetrans 提交失败，切换备用 Qwen Key 重试 "
                f"({attempt}/{attempts}, key={mask_api_key(api_key)}): {exc}"
            )
    if last_error:
        raise last_error


def wait_qwen_filetrans_task(task_id, headers):
    base_url = get_qwen_asr_api_base_url()
    task_url = f"{base_url}/tasks/{task_id}"
    timeout_seconds = max(30, int(float(os.getenv("QWEN_ASR_FILETRANS_TIMEOUT_SECONDS", QWEN_FILETRANS_TASK_TIMEOUT_SECONDS))))
    poll_seconds = max(1.0, float(os.getenv("QWEN_ASR_FILETRANS_POLL_SECONDS", QWEN_FILETRANS_POLL_SECONDS)))
    deadline = time.time() + timeout_seconds

    while True:
        response = requests.get(task_url, headers=headers, timeout=60)
        response.raise_for_status()
        payload = response.json()
        output = payload.get("output") if isinstance(payload, dict) else {}
        status = str((output or {}).get("task_status") or payload.get("task_status") or "").upper()
        if status in {"SUCCEEDED", "SUCCESS", "COMPLETED"}:
            return payload
        if status in {"FAILED", "CANCELED", "CANCELLED"}:
            message = (output or {}).get("message") or (output or {}).get("error") or payload
            raise RuntimeError(f"Filetrans 任务失败: {message}")
        if time.time() >= deadline:
            raise TimeoutError(f"Filetrans 任务超时: {task_id}")
        time.sleep(poll_seconds)
