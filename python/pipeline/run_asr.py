import sys
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from faster_whisper import WhisperModel
import json
import time
import os
import subprocess
import argparse
import re
import uuid
import difflib
from pathlib import Path
from urllib.parse import urlparse

import requests

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from llm_client import create_llm_client, generate_content, get_llm_provider, get_text_llm_provider
from script_protocol import emit_result, emit_stage, run_guarded
try:
    from skills.prompt_skill_loader import load_prompt_text
except ImportError:
    from pipeline.skills.prompt_skill_loader import load_prompt_text
try:
    from subtitle_terms import (
        extract_preserve_terms,
        mask_preserved_terms,
        normalize_chinese_numeric_display,
        repair_reference_subtitle_text,
        select_present_reference_terms,
        restore_preserved_terms,
        to_simplified_chinese,
    )
except ImportError:
    from pipeline.subtitle_terms import (
        extract_preserve_terms,
        mask_preserved_terms,
        normalize_chinese_numeric_display,
        repair_reference_subtitle_text,
        select_present_reference_terms,
        restore_preserved_terms,
        to_simplified_chinese,
    )

load_project_env(__file__)

class MockWord:
    def __init__(self, start, end, word):
        self.start = float(start)
        self.end = float(end)
        self.word = word

class MockSegment:
    def __init__(self, start, end, text, words):
        self.start = float(start)
        self.end = float(end)
        self.text = text
        self.words = words

def _get_audio_duration(audio_file):
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", audio_file],
            capture_output=True, text=True, timeout=15,
        )
        return float((probe.stdout or "").strip() or 0.0)
    except Exception:
        return 0.0


DEFAULT_QWEN_ASR_MODEL = "qwen3-asr-flash-filetrans"
LEGACY_QWEN_ASR_MODEL = "qwen3-asr-flash"
QWEN_FILETRANS_TASK_TIMEOUT_SECONDS = 900
QWEN_FILETRANS_POLL_SECONDS = 5
ALIYUN_ASR_MAX_SIZE = 8 * 1024 * 1024
ALIYUN_ASR_CHUNK_SEC = 300


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


def upload_filetrans_audio_to_oss(local_file):
    config = get_oss_filetrans_config()
    if not config:
        return "", None
    if not os.path.exists(local_file):
        raise FileNotFoundError(f"待上传的 ASR 音频不存在: {local_file}")

    object_key = make_oss_object_key(local_file, prefix=config["prefix"])
    bucket = create_oss_bucket(config)
    bucket.put_object_from_file(object_key, local_file)
    signed_url = bucket.sign_url("GET", object_key, config["expires_seconds"])
    if not is_public_http_url(signed_url):
        raise RuntimeError("OSS 未返回可用于 Filetrans 的公网签名 URL。")

    print(f"   -> 已上传 ASR 音频到 OSS: oss://{config['bucket']}/{object_key}")
    return signed_url, object_key


def resolve_filetrans_file_url(local_file, file_url=""):
    if is_public_http_url(file_url):
        return file_url, None
    return upload_filetrans_audio_to_oss(local_file)


def parse_seconds(value, *, milliseconds=False):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if milliseconds or abs(number) >= 1000:
        number = number / 1000.0
    return round(number, 2)


def infer_language_from_text(text):
    if has_cjk(text):
        return "zh"
    if is_english_like(text):
        return "en"
    return ""


def collect_transcripts(payload):
    transcripts = []
    if isinstance(payload, dict):
        candidate = payload.get("transcripts")
        if isinstance(candidate, list):
            transcripts.extend(item for item in candidate if isinstance(item, dict))
        for value in payload.values():
            transcripts.extend(collect_transcripts(value))
    elif isinstance(payload, list):
        for item in payload:
            transcripts.extend(collect_transcripts(item))
    return transcripts


def sentence_time_range(sentence):
    if "begin_time" in sentence:
        start = parse_seconds(sentence.get("begin_time"), milliseconds=True)
        end = parse_seconds(sentence.get("end_time", sentence.get("end")), milliseconds=True)
    else:
        start = parse_seconds(sentence.get("start_time", sentence.get("start")), milliseconds=False)
        end = parse_seconds(sentence.get("end_time", sentence.get("end")), milliseconds=False)
    if start is None or end is None or end <= start:
        return None
    return start, end


def should_insert_filetrans_space(current_text, token):
    if not current_text or not token:
        return False

    first_char = token[0]
    if not re.match(r"[A-Za-z0-9$]", first_char):
        return False

    previous_char = current_text[-1]
    if previous_char in ".,，" and len(current_text) >= 2 and current_text[-2].isdigit() and first_char.isdigit():
        return False

    return bool(re.search(r"[A-Za-z0-9%\)]$", current_text) or previous_char in ".,!?;:")


def join_filetrans_tokens(tokens):
    parts = []
    for token in tokens:
        token_text = str(token or "").strip()
        if not token_text:
            continue
        current_text = "".join(parts)
        if should_insert_filetrans_space(current_text, token_text):
            parts.append(" ")
        parts.append(token_text)
    return "".join(parts).strip()


def reconstruct_filetrans_words(words):
    tokens = []
    has_punctuation = False
    for word in words:
        if not isinstance(word, dict):
            continue
        token = str(word.get("text") or word.get("word") or "").strip()
        punctuation = str(word.get("punctuation") or "").strip()
        if not token:
            continue
        if punctuation and not token.endswith(punctuation):
            token = f"{token}{punctuation}"
            has_punctuation = True
        elif punctuation:
            has_punctuation = True
        tokens.append(token)
    return join_filetrans_tokens(tokens), has_punctuation


def sentence_text(sentence):
    words = sentence.get("words")
    if isinstance(words, list):
        reconstructed, has_punctuation = reconstruct_filetrans_words(words)
        raw_text = str(sentence.get("text") or sentence.get("sentence") or sentence.get("sentence_text") or "").strip()
        if reconstructed and (
            has_punctuation
            or not raw_text
            or (" " in reconstructed and " " not in raw_text)
        ):
            return apply_domain_corrections(reconstructed)

    text = str(sentence.get("text") or sentence.get("sentence") or sentence.get("sentence_text") or "").strip()
    if text:
        return apply_domain_corrections(text)
    return ""


def parse_word_seconds(word, start_keys, *, default=None):
    for key in start_keys:
        if key in word:
            return parse_seconds(word.get(key), milliseconds=(key in {"begin_time", "end_time"}))
    return default


def sentence_words(sentence):
    words = sentence.get("words")
    if not isinstance(words, list):
        return []

    parsed = []
    for word in words:
        if not isinstance(word, dict):
            continue
        text = str(word.get("text") or word.get("word") or "").strip()
        punctuation = str(word.get("punctuation") or "").strip()
        if punctuation and text and not text.endswith(punctuation):
            text = f"{text}{punctuation}"
        start = parse_word_seconds(word, ("begin_time", "start_time", "start"))
        end = parse_word_seconds(word, ("end_time", "end"))
        if not text or start is None or end is None or end <= start:
            continue
        parsed.append(MockWord(start, end, text))
    return parsed


def parse_filetrans_result_segments(payload, include_words=False):
    raw_segments = []
    detected_language = ""
    transcript_text_parts = []

    for transcript in collect_transcripts(payload):
        language = str(
            transcript.get("language")
            or transcript.get("language_code")
            or transcript.get("detected_language")
            or ""
        ).strip().lower()
        if language and not detected_language:
            detected_language = language
        transcript_text = str(transcript.get("text") or "").strip()
        if transcript_text:
            transcript_text_parts.append(transcript_text)
        sentences = transcript.get("sentences") or transcript.get("sentence")
        if not isinstance(sentences, list):
            continue
        for sentence in sentences:
            if not isinstance(sentence, dict):
                continue
            time_range = sentence_time_range(sentence)
            text = sentence_text(sentence)
            if not time_range or not text:
                continue
            segment = {
                "start": time_range[0],
                "end": time_range[1],
                "text": text
            }
            if include_words:
                words = sentence_words(sentence)
                if words:
                    segment["words"] = words
            raw_segments.append(segment)
            if not detected_language:
                detected_language = str(sentence.get("language") or sentence.get("language_code") or "").strip().lower()

    raw_segments.sort(key=lambda item: (item["start"], item["end"]))
    if not detected_language:
        sample_text = "".join(item["text"] for item in raw_segments) or "".join(transcript_text_parts)
        detected_language = infer_language_from_text(sample_text) or "zh"
    return raw_segments, detected_language


def fetch_json(url, headers=None):
    response = requests.get(url, headers=headers or {}, timeout=60)
    response.raise_for_status()
    return response.json()


def expand_filetrans_transcription_urls(payload, headers=None):
    if isinstance(payload, dict):
        url = payload.get("transcription_url")
        if is_public_http_url(url):
            try:
                payload["transcription"] = fetch_json(url)
            except Exception as err:
                response = getattr(err, "response", None)
                status_code = getattr(response, "status_code", None)
                status_text = f" status={status_code}" if status_code else ""
                print(f"   ⚠️ 获取 Filetrans 转写结果失败: {err.__class__.__name__}{status_text}")
        for value in payload.values():
            expand_filetrans_transcription_urls(value, headers=headers)
    elif isinstance(payload, list):
        for item in payload:
            expand_filetrans_transcription_urls(item, headers=headers)
    return payload


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


def _compress_audio_for_asr(audio_file):
    compressed = os.path.splitext(audio_file)[0] + "_asr_tmp.mp3"
    subprocess.run(
        ["ffmpeg", "-y", "-i", audio_file, "-ac", "1", "-ar", "16000", "-b:a", "48k", compressed],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    if os.path.exists(compressed) and os.path.getsize(compressed) > 0:
        return compressed
    return None


def _split_audio_chunks(audio_file, chunk_sec=ALIYUN_ASR_CHUNK_SEC):
    duration = _get_audio_duration(audio_file)
    if duration <= 0:
        return [(audio_file, 0.0)], duration
    if duration <= chunk_sec:
        return [(audio_file, 0.0)], duration
    chunks = []
    base = os.path.splitext(audio_file)[0]
    offset = 0.0
    idx = 0
    while offset < duration:
        chunk_path = f"{base}_chunk{idx}.mp3"
        subprocess.run(
            ["ffmpeg", "-y", "-ss", str(offset), "-t", str(chunk_sec),
             "-i", audio_file, "-ac", "1", "-ar", "16000", "-b:a", "48k", chunk_path],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        if os.path.exists(chunk_path) and os.path.getsize(chunk_path) > 0:
            chunks.append((chunk_path, offset))
        offset += chunk_sec
        idx += 1
    return chunks, duration


def _call_aliyun_asr(dashscope_module, audio_path, *, api_key, model=None):
    messages = [
        {"role": "user", "content": [{"audio": audio_path}]}
    ]
    return dashscope_module.MultiModalConversation.call(
        api_key=api_key,
        model=model or LEGACY_QWEN_ASR_MODEL,
        messages=messages,
        result_format="message",
        asr_options={"enable_itn": True},
    )


def build_raw_segments_filetrans(file_url, model=None, split_config=None):
    model = model or get_qwen_asr_model()
    emit_stage("asr", "正在进行阿里云 Qwen3-ASR Filetrans 句级识别")
    print(f"1. 正在提交阿里云 {model} 文件转写任务...")
    task_id, headers = submit_qwen_filetrans_task(file_url, model)
    print(f"   -> Filetrans task_id: {task_id}")
    payload = wait_qwen_filetrans_task(task_id, headers)
    payload = expand_filetrans_transcription_urls(payload, headers=headers)
    raw_segments, detected_language = parse_filetrans_result_segments(payload, include_words=True)
    if not raw_segments:
        print("   ℹ️ Filetrans 调用成功但未解析到句级时间戳")
        return [], detected_language or "zh"

    raw_sentence_count = len(raw_segments)
    split_segments = split_filetrans_segments(raw_segments, split_config=split_config)
    if split_segments:
        raw_segments = split_segments

    print(f"   ✅ Filetrans 识别完成，语种: {detected_language}，句子数: {raw_sentence_count}，字幕段数: {len(raw_segments)}")
    for item in raw_segments:
        print(f"   [ASR filetrans]: {item['text']}")
    return raw_segments, detected_language


def build_raw_segments_qwen_flash(audio_file, split_config=None, model=None):
    import dashscope
    from qwen_client import create_qwen_client, is_key_failover_error, mask_api_key
    qwen_client = create_qwen_client()
    model = model or LEGACY_QWEN_ASR_MODEL

    emit_stage("asr", "正在进行阿里云 Qwen3-ASR 识别")
    print(f"1. 正在调用阿里云 {model} 进行语音识别...")

    actual_file = audio_file
    compressed_file = None
    file_size = os.path.getsize(audio_file) if os.path.exists(audio_file) else 0
    if file_size > ALIYUN_ASR_MAX_SIZE:
        print(f"   音频文件 {file_size / 1024 / 1024:.1f}MB 超过大小限制，压缩中...")
        compressed_file = _compress_audio_for_asr(audio_file)
        if compressed_file:
            new_size = os.path.getsize(compressed_file)
            print(f"   压缩完成: {new_size / 1024 / 1024:.1f}MB")
            actual_file = compressed_file
        else:
            print("   ⚠️ 压缩失败，尝试使用原始文件")

    audio_duration = _get_audio_duration(actual_file)
    need_chunking = audio_duration > ALIYUN_ASR_CHUNK_SEC
    chunks_to_clean = []

    if need_chunking:
        print(f"   音频时长 {audio_duration:.0f}s 超过限制，分段处理（每段 {ALIYUN_ASR_CHUNK_SEC}s）...")
        chunk_list, audio_duration = _split_audio_chunks(actual_file, ALIYUN_ASR_CHUNK_SEC)
        chunks_to_clean = [p for p, _ in chunk_list if p != actual_file]
    else:
        chunk_list = [(actual_file, 0.0)]

    all_text_parts = []
    detected_language = "zh"

    try:
        for chunk_idx, (chunk_path, chunk_offset) in enumerate(chunk_list):
            if need_chunking:
                print(f"   识别分段 {chunk_idx + 1}/{len(chunk_list)}...")
            resolved_path = str(Path(chunk_path).resolve())
            response = None
            for key_attempt in range(1, qwen_client.key_count + 1):
                api_key = qwen_client.api_key
                try:
                    response = _call_aliyun_asr(dashscope, resolved_path, api_key=api_key, model=model)
                    break
                except Exception as err:
                    if is_key_failover_error(err) and key_attempt < qwen_client.key_count:
                        qwen_client.mark_key_unavailable(api_key)
                        print(
                            f"   ⚠️ 阿里云 ASR Key 不可用，切换备用 Key "
                            f"({key_attempt}/{qwen_client.key_count}, key={mask_api_key(api_key)}): {err}"
                        )
                        continue
                    raise

            status_code = getattr(response, "status_code", None)
            if status_code != 200:
                error = RuntimeError(
                    f"阿里云 ASR 返回异常: status_code={status_code}, "
                    f"code={getattr(response, 'code', '?')}, message={getattr(response, 'message', '?')}"
                )
                if is_key_failover_error(error):
                    qwen_client.mark_key_unavailable(api_key)
                    if qwen_client.key_count > 1:
                        for retry_idx in range(1, qwen_client.key_count):
                            fallback_key = qwen_client.api_key
                            response = _call_aliyun_asr(
                                dashscope,
                                resolved_path,
                                api_key=fallback_key,
                                model=model,
                            )
                            status_code = getattr(response, "status_code", None)
                            if status_code == 200:
                                api_key = fallback_key
                                break
                            retry_error = RuntimeError(
                                f"阿里云 ASR 返回异常: status_code={status_code}, "
                                f"code={getattr(response, 'code', '?')}, message={getattr(response, 'message', '?')}"
                            )
                            if is_key_failover_error(retry_error):
                                qwen_client.mark_key_unavailable(fallback_key)
                            print(
                                f"   ⚠️ 备用 Qwen Key ASR 仍失败 "
                                f"({retry_idx}/{qwen_client.key_count - 1}, key={mask_api_key(fallback_key)}): {retry_error}"
                            )
                        if getattr(response, "status_code", None) == 200:
                            print("   ✅ 已切换备用 Qwen Key 完成当前 ASR 分段")
                        else:
                            return [], "zh"
                if getattr(response, "status_code", None) != 200:
                    print(f"   ⚠️ {error}")
                    return [], "zh"

            choices = (response.output or {}).get("choices") or []
            if not choices:
                continue

            message = choices[0].get("message", {})
            content_list = message.get("content") or []
            chunk_text = ""
            for item in content_list:
                if isinstance(item, dict) and item.get("text"):
                    chunk_text += item["text"]

            annotations = message.get("annotations") or []
            for ann in annotations:
                if isinstance(ann, dict) and ann.get("language"):
                    detected_language = ann["language"]
                    break

            if chunk_text.strip():
                all_text_parts.append((chunk_text.strip(), chunk_offset, _get_audio_duration(chunk_path)))
    finally:
        for path in chunks_to_clean:
            try:
                os.remove(path)
            except Exception:
                pass
        if compressed_file and os.path.exists(compressed_file):
            try:
                os.remove(compressed_file)
            except Exception:
                pass

    if not all_text_parts:
        print("   ℹ️ 阿里云 ASR 调用成功但未识别到语音内容")
        return [], detected_language

    full_text = " ".join(t for t, _, _ in all_text_parts)
    print(f"   ✅ 阿里云 ASR 识别完成，语种: {detected_language}，全文长度: {len(full_text)}")

    if audio_duration <= 0:
        audio_duration = max(10.0, len(full_text) / 4.0)

    raw_segments = []
    for part_text, part_offset, part_duration in all_text_parts:
        if part_duration <= 0:
            part_duration = max(1.0, len(part_text) / 4.0)
        sentence_delimiters = r'(?<=[.!?。！？;；])\s*'
        sentence_texts = [s.strip() for s in re.split(sentence_delimiters, part_text) if s.strip()]
        if not sentence_texts:
            sentence_texts = [part_text.strip()]

        total_chars = sum(len(s) for s in sentence_texts)
        cursor = part_offset
        for text in sentence_texts:
            ratio = len(text) / total_chars if total_chars > 0 else 1.0 / len(sentence_texts)
            duration = part_duration * ratio
            seg_start = round(cursor, 2)
            seg_end = round(cursor + duration, 2)
            seg = MockSegment(seg_start, seg_end, text, [])
            sub_segments = split_segment_words(seg, split_config=split_config)
            for item in sub_segments:
                raw_segments.append(item)
                print(f"   [ASR qwen3]: {item['text']}")
            cursor = seg_end

    return raw_segments, detected_language


def build_raw_segments_aliyun(audio_file, split_config=None, file_url=""):
    model = get_qwen_asr_model()
    if model == DEFAULT_QWEN_ASR_MODEL:
        resolved_file_url, _object_key = resolve_filetrans_file_url(audio_file, file_url)
        if resolved_file_url:
            return build_raw_segments_filetrans(resolved_file_url, model=model, split_config=split_config)
        print("   ⚠️ Qwen Filetrans 需要公网 file_url 或可用 OSS 上传配置，当前将降级使用 qwen3-asr-flash。")
        return build_raw_segments_qwen_flash(audio_file, split_config=split_config, model=LEGACY_QWEN_ASR_MODEL)
    return build_raw_segments_qwen_flash(audio_file, split_config=split_config, model=model)

GLOSSARY_PATH = os.path.join(os.path.dirname(__file__), "glossary.json")
DEFAULT_SPLIT_CONFIG = {
    "max_chunk_duration": 4.2,
    "soft_chunk_duration": 2.8,
    "max_visible_chars": 26,
    "max_words_per_chunk": 10,
    "pause_threshold": 0.42,
}

def visible_text(text: str) -> str:
    return re.sub(r"[\s，。！？；：、“”‘’,.!?;:()\[\]{}\"'…·-]", "", text or "")


CHINESE_NUMERAL_DIGITS = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}


def parse_small_chinese_number(text: str):
    sample = str(text or "")
    if not sample:
        return None
    if sample == "十":
        return 10
    if "十" in sample:
        left, right = sample.split("十", 1)
        if "十" in right:
            return None
        tens = 1 if not left else CHINESE_NUMERAL_DIGITS.get(left)
        ones = 0 if not right else CHINESE_NUMERAL_DIGITS.get(right)
        if tens is None or ones is None:
            return None
        return tens * 10 + ones
    if len(sample) == 1:
        return CHINESE_NUMERAL_DIGITS.get(sample)
    if all(char in CHINESE_NUMERAL_DIGITS for char in sample):
        return int("".join(str(CHINESE_NUMERAL_DIGITS[char]) for char in sample))
    return None


def normalize_visible_text_for_reference_match(text: str) -> str:
    sample = visible_text(text).lower()

    def replace_number(match):
        value = parse_small_chinese_number(match.group(1))
        return str(value) if value is not None else match.group(1)

    return re.sub(
        r"([零〇一二两三四五六七八九十]{1,3})(?=[年月日天个只条次位栋%万亿千百美元元])",
        replace_number,
        sample,
    )


def has_cjk(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text or ""))


def has_japanese(text: str) -> bool:
    return bool(re.search(r"[\u3040-\u30ff]", text or ""))


def is_english_like(text: str) -> bool:
    sample = re.sub(r"\s+", " ", text or "").strip()
    if not sample:
        return False
    letters = re.findall(r"[A-Za-z]", sample)
    cjk = re.findall(r"[\u4e00-\u9fff]", sample)
    return len(letters) >= 4 and len(letters) > len(cjk) * 2


def is_chinese_language(language: str) -> bool:
    return str(language or "").lower().startswith("zh")


def is_english_language(language: str) -> bool:
    return str(language or "").lower().startswith("en")


def load_domain_corrections():
    if not os.path.exists(GLOSSARY_PATH):
        return {}
    with open(GLOSSARY_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, dict) else {}


DOMAIN_CORRECTIONS = load_domain_corrections()


def apply_domain_corrections(text: str) -> str:
    normalized = to_simplified_chinese(text or "")
    for wrong, right in sorted(DOMAIN_CORRECTIONS.items(), key=lambda item: len(item[0]), reverse=True):
        normalized = re.sub(re.escape(wrong), right, normalized, flags=re.IGNORECASE)
    normalized = normalized.replace("万事达卡卡", "万事达卡")
    normalized = normalize_chinese_numeric_display(normalized)
    return to_simplified_chinese(normalized)


def normalize_subtitles_to_simplified(subtitles):
    if not isinstance(subtitles, list):
        return []

    normalized = []
    for entry in subtitles:
        if not isinstance(entry, dict):
            continue
        item = dict(entry)
        for key in ("zh", "text"):
            if item.get(key):
                item[key] = apply_domain_corrections(str(item[key]).strip())
        if item.get("en"):
            item["en"] = to_simplified_chinese(str(item["en"]).strip())
        normalized.append(item)
    return normalized


def time_overlap_ratio(start_a, end_a, start_b, end_b):
    left = max(float(start_a), float(start_b))
    right = min(float(end_a), float(end_b))
    overlap = max(0.0, right - left)
    if overlap <= 0:
        return 0.0
    duration_a = max(0.01, float(end_a) - float(start_a))
    duration_b = max(0.01, float(end_b) - float(start_b))
    return overlap / min(duration_a, duration_b)


def contains_sentence_break(text: str) -> bool:
    return any(char in str(text or "") for char in "。！？!?；;")


def is_numeric_separator(text: str, index: int) -> bool:
    if not (0 <= index < len(text)):
        return False
    if text[index] not in ".,，":
        return False
    previous_char = text[index - 1] if index > 0 else ""
    next_char = text[index + 1] if index + 1 < len(text) else ""
    return previous_char.isdigit() and next_char.isdigit()


def contains_clause_break(text: str) -> bool:
    sample = str(text or "")
    for index, char in enumerate(sample):
        if char in "。！？!?；;、":
            return True
        if char in "，," and not is_numeric_separator(sample, index):
            return True
    return False


def detect_token_language(token: str) -> str:
    sample = str(token or "").strip()
    if not sample:
        return "other"
    if has_cjk(sample) or has_japanese(sample):
        return "zh"
    if re.search(r"[A-Za-z]", sample):
        return "en"
    return "other"


def flush_word_chunk(chunks, words, start_time, end_time):
    if not words:
        return
    text = apply_domain_corrections(join_filetrans_tokens(words))
    if not text:
        return
    chunks.append({
        "start": round(float(start_time), 2),
        "end": round(float(end_time), 2),
        "text": text
    })


def resolve_split_config(raw_config=None):
    config = dict(DEFAULT_SPLIT_CONFIG)
    if isinstance(raw_config, dict):
        for key in config:
            value = raw_config.get(key)
            if value is None:
                continue
            try:
                config[key] = float(value)
            except (TypeError, ValueError):
                continue

    config["max_chunk_duration"] = max(1.6, float(config["max_chunk_duration"]))
    config["soft_chunk_duration"] = max(1.0, min(float(config["soft_chunk_duration"]), config["max_chunk_duration"]))
    config["max_visible_chars"] = max(8, int(round(float(config["max_visible_chars"]))))
    config["max_words_per_chunk"] = max(3, int(round(float(config["max_words_per_chunk"]))))
    config["pause_threshold"] = max(0.12, float(config["pause_threshold"]))
    return config


def split_segment_words(segment, split_config=None, allow_clause_breaks=False):
    split_config = resolve_split_config(split_config)
    words = list(getattr(segment, "words", None) or [])
    if not words:
        text = apply_domain_corrections(str(getattr(segment, "text", "")).strip())
        return split_text_segment_by_clauses({
            "start": float(getattr(segment, "start", 0.0) or 0.0),
            "end": float(getattr(segment, "end", 0.0) or 0.0),
            "text": text
        }, split_config=split_config)

    chunks = []
    current_words = []
    chunk_start = None
    chunk_end = None
    current_lang = "other"

    for index, word in enumerate(words):
        token = str(getattr(word, "word", "") or "")
        if not token.strip():
            continue

        token_start = float(getattr(word, "start", getattr(segment, "start", 0.0)) or 0.0)
        token_end = float(getattr(word, "end", token_start) or token_start)
        next_word = words[index + 1] if index + 1 < len(words) else None
        next_start = float(getattr(next_word, "start", token_end) or token_end) if next_word else None
        token_lang = detect_token_language(token)

        if chunk_start is None:
            chunk_start = token_start
            current_lang = token_lang

        lang_switched = (
            current_words
            and token_lang in {"zh", "en"}
            and current_lang in {"zh", "en"}
            and token_lang != current_lang
        )
        if lang_switched:
            current_visible_len = len(visible_text("".join(current_words)))
            current_duration = max(0.0, (chunk_end or token_start) - chunk_start)
            if current_visible_len >= 6 or current_duration >= max(0.6, split_config["soft_chunk_duration"] * 0.7):
                flush_word_chunk(chunks, current_words, chunk_start, chunk_end or token_start)
                current_words = []
                chunk_start = token_start
                chunk_end = None
                current_lang = token_lang

        current_words.append(token)
        chunk_end = token_end
        if token_lang in {"zh", "en"}:
            current_lang = token_lang

        joined_text = "".join(current_words).strip()
        duration = max(0.0, chunk_end - chunk_start)
        visible_len = len(visible_text(joined_text))
        sentence_break = contains_sentence_break(token) or (allow_clause_breaks and contains_clause_break(token))
        long_enough = duration >= split_config["soft_chunk_duration"]
        too_long = duration >= split_config["max_chunk_duration"] or visible_len >= split_config["max_visible_chars"]
        enough_words = len(current_words) >= split_config["max_words_per_chunk"]
        next_gap = (next_start - token_end) if next_start is not None else 0.0
        natural_pause = next_gap >= split_config["pause_threshold"]

        should_flush = False
        if sentence_break and duration >= 1.0:
            should_flush = True
        elif too_long:
            should_flush = True
        elif long_enough and (enough_words or natural_pause):
            should_flush = True

        if should_flush:
            flush_word_chunk(chunks, current_words, chunk_start, chunk_end)
            current_words = []
            chunk_start = None
            chunk_end = None

    flush_word_chunk(chunks, current_words, chunk_start, chunk_end)
    return chunks


def split_text_by_clause_boundaries(text):
    sample = str(text or "").strip()
    if not sample:
        return []

    pieces = []
    start = 0
    for index, char in enumerate(sample):
        should_break = char in "。！？!?；;、：:" or (char in "，," and not is_numeric_separator(sample, index))
        if not should_break:
            continue
        piece = sample[start:index + 1].strip()
        if piece:
            pieces.append(piece)
        start = index + 1

    tail = sample[start:].strip()
    if tail:
        pieces.append(tail)
    return pieces or [sample]


def split_long_text_piece(piece, max_visible_chars):
    sample = str(piece or "").strip()
    if len(visible_text(sample)) <= max_visible_chars:
        return [sample] if sample else []

    chunks = []
    current = ""
    for char in sample:
        candidate = f"{current}{char}"
        if current and len(visible_text(candidate)) > max_visible_chars:
            chunks.append(current.strip())
            current = char
        else:
            current = candidate
    if current.strip():
        chunks.append(current.strip())
    return chunks


def split_text_segment_by_clauses(segment, split_config=None):
    split_config = resolve_split_config(split_config)
    text = apply_domain_corrections(str(segment.get("text") or "").strip())
    if not text:
        return []

    start = float(segment.get("start", 0.0) or 0.0)
    end = float(segment.get("end", start) or start)
    if end <= start:
        return []

    pieces = []
    for piece in split_text_by_clause_boundaries(text):
        pieces.extend(split_long_text_piece(piece, split_config["max_visible_chars"]))

    if len(pieces) <= 1:
        return [{"start": round(start, 2), "end": round(end, 2), "text": text}]

    weights = [max(1, len(visible_text(piece))) for piece in pieces]
    total_weight = max(1, sum(weights))
    duration = end - start
    cursor = start
    chunks = []
    for index, piece in enumerate(pieces):
        if index == len(pieces) - 1:
            piece_end = end
        else:
            piece_end = cursor + duration * (weights[index] / total_weight)
        chunks.append({
            "start": round(cursor, 2),
            "end": round(piece_end, 2),
            "text": apply_domain_corrections(piece)
        })
        cursor = piece_end
    return chunks


def split_filetrans_segments(raw_segments, split_config=None):
    if not raw_segments:
        return []

    split_config = resolve_split_config(split_config)
    chunks = []
    split_count = 0
    for segment in raw_segments:
        words = segment.get("words") if isinstance(segment, dict) else None
        if words:
            next_chunks = split_segment_words(
                MockSegment(segment["start"], segment["end"], segment["text"], words),
                split_config=split_config,
                allow_clause_breaks=True
            )
        else:
            next_chunks = split_text_segment_by_clauses(segment, split_config=split_config)
        if len(next_chunks) > 1:
            split_count += len(next_chunks) - 1
        chunks.extend(next_chunks)

    if split_count:
        print(f"   ✅ Filetrans 句级结果已细分为短字幕块: +{split_count} 段")
    return chunks


def build_default_speaker_scene(subtitles):
    timeline = []
    for entry in subtitles:
        time_range = entry.get("time") or [0.0, 0.0]
        if len(time_range) < 2:
            continue
        timeline.append({
            "start": float(time_range[0]),
            "end": float(time_range[1]),
            "active_speakers": ["speaker_1"],
            "speaker_count": 1,
            "relationship_hint": "默认主讲",
            "focus_target": "speaker_1",
            "shot_type": "single",
            "vertical_mode": "follow_speaker",
            "crop_anchor": "center",
            "crop_x_ratio": 0.5,
            "reason": "未识别到可靠多人关系信息，回退为默认单人主讲居中方案。"
        })

    return {
        "participant_count": 1,
        "relationship_summary": "默认单人主讲场景，适合 9:16 居中取景。",
        "participants": [
            {
                "speaker_id": "speaker_1",
                "label": "主讲人",
                "role": "主说话人",
                "visual_hint": "center",
                "confidence": 0.2
            }
        ],
        "timeline": timeline,
        "global_guidance": {
            "default_vertical_mode": "follow_speaker",
            "default_crop_anchor": "center",
            "default_crop_x_ratio": 0.5,
            "notes": [
                "若后续视觉轴提供多人位置信息，可升级为左右切换或多人中景。"
            ]
        }
    }

def build_raw_subtitles(raw_segments, source_language=""):
    subtitles = []
    for segment in raw_segments:
        original_text = apply_domain_corrections(str(segment.get("text", "")).strip())
        if not original_text:
            continue
        en_text = original_text if is_english_language(source_language) else ""
        subtitles.append({
            "time": [segment["start"], segment["end"]],
            "zh": original_text,
            "en": en_text,
            "text": original_text,
        })
    return subtitles


def get_text_model_for_provider(provider):
    if provider == "deepseek":
        return os.getenv("DEEPSEEK_TEXT_MODEL", "deepseek-v4-pro")
    if provider in {"gemini", "vertex"}:
        return os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
    return os.getenv("QWEN_TEXT_MODEL", "qwen-max")


def parse_json_array_from_text(text):
    payload = str(text or "").strip()
    if not payload:
        return []
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        match = re.search(r"\[[\s\S]*\]", payload)
        if not match:
            return []
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return []
    return data if isinstance(data, list) else []


def chunked(items, size):
    for index in range(0, len(items), size):
        yield items[index:index + size]


def read_reference_subtitles(file_path):
    if not file_path or not os.path.exists(file_path):
        return []

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception:
        return []

    if isinstance(payload, dict):
        for key in ("subtitles", "items", "segments", "data"):
            candidate = payload.get(key)
            if isinstance(candidate, list):
                payload = candidate
                break

    if not isinstance(payload, list):
        return []

    normalized = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        time_range = item.get("time")
        if not isinstance(time_range, list) or len(time_range) < 2:
            time_range = [item.get("start"), item.get("end")]
        start = parse_seconds(time_range[0], milliseconds=False)
        end = parse_seconds(time_range[1], milliseconds=False)
        if start is None or end is None or end <= start:
            continue
        zh_text = apply_domain_corrections(str(item.get("zh") or item.get("text") or item.get("subtitle_text") or item.get("subtitle") or "").strip())
        en_text = to_simplified_chinese(str(item.get("en") or item.get("english") or item.get("subtitle_en") or "").strip())
        normalized.append({
            "time": [start, end],
            "zh": zh_text,
            "en": en_text,
            "text": zh_text or en_text
        })

    return normalized


def summarize_reference_context(reference_subtitles, start, end, limit=4):
    if not reference_subtitles:
        return ""

    center = (float(start) + float(end)) / 2.0
    scored = []
    for ref in reference_subtitles:
        ref_time = ref.get("time") or [0.0, 0.0]
        ref_start = float(ref_time[0] or 0.0)
        ref_end = float(ref_time[1] or 0.0)
        overlap = time_overlap_ratio(start, end, ref_start, ref_end)
        if overlap > 0:
            score = -overlap
        else:
            ref_center = (ref_start + ref_end) / 2.0
            score = abs(ref_center - center)
        text = str(ref.get("zh") or ref.get("text") or ref.get("en") or "").strip()
        if text:
            scored.append((score, text))

    if not scored:
        return ""

    scored.sort(key=lambda item: item[0])
    return "\n".join(text for _score, text in scored[:max(1, int(limit))])


def score_reference_alignment_window(asr_visible, reference_visible):
    asr_sample = str(asr_visible or "").lower()
    reference_sample = str(reference_visible or "").lower()
    if not asr_sample or not reference_sample:
        return 0.0

    sequence_score = difflib.SequenceMatcher(None, asr_sample, reference_sample).ratio()
    asr_chars = set(asr_sample)
    reference_chars = set(reference_sample)
    coverage_score = len(asr_chars & reference_chars) / max(1, len(asr_chars))
    length_penalty = abs(len(reference_sample) - len(asr_sample)) / max(len(reference_sample), len(asr_sample), 1)
    return sequence_score + coverage_score * 0.45 - length_penalty * 0.2


def select_reference_context_for_asr(reference_text, asr_text, max_window_size=3):
    reference_sample = str(reference_text or "").strip()
    asr_visible = visible_text(asr_text)
    if not reference_sample or not asr_visible:
        return reference_sample

    pieces = split_text_by_clause_boundaries(reference_sample)
    if len(pieces) <= 1:
        return reference_sample

    best_score = 0.0
    best_text = reference_sample
    window_limit = max(1, int(max_window_size))
    for start_index in range(len(pieces)):
        max_size = min(window_limit, len(pieces) - start_index)
        for size in range(1, max_size + 1):
            candidate = "".join(pieces[start_index:start_index + size]).strip()
            candidate_visible = visible_text(candidate)
            if not candidate_visible:
                continue
            score = score_reference_alignment_window(asr_visible, candidate_visible)
            if score > best_score:
                best_score = score
                best_text = candidate

    return best_text if best_score >= 0.18 else reference_sample


PROTECTED_TERM_LEADING_WORDS = {
    "at",
    "by",
    "for",
    "from",
    "in",
    "into",
    "of",
    "on",
    "to",
    "with",
}


def normalize_protected_term(term):
    cleaned = re.sub(r"\s+", " ", str(term or "")).strip()
    if not cleaned or not re.search(r"[A-Za-z]", cleaned):
        return ""

    parts = cleaned.split()
    while len(parts) > 1 and parts[0].lower() in PROTECTED_TERM_LEADING_WORDS:
        parts = parts[1:]
    cleaned = " ".join(parts).strip()
    if not cleaned or cleaned.lower() in PROTECTED_TERM_LEADING_WORDS:
        return ""
    return cleaned


def build_protected_terms(*texts, max_terms=8):
    combined = "\n".join(str(text or "") for text in texts if str(text or "").strip())
    if not combined:
        return []

    terms = []
    for term in extract_preserve_terms(combined, max_terms=max(max_terms * 3, 12)):
        normalized = normalize_protected_term(term)
        if not normalized or normalized in terms:
            continue
        terms.append(normalized)
        if len(terms) >= max_terms:
            break
    return terms


def find_missing_protected_terms(text, protected_terms):
    sample = str(text or "")
    missing = []
    for term in protected_terms or []:
        candidate = str(term or "").strip()
        if candidate and candidate not in sample:
            missing.append(candidate)
    return missing


def repair_subtitle_text_with_sources(text, *source_texts):
    repaired = str(text or "")
    for source_text in source_texts:
        reference = str(source_text or "").strip()
        if reference:
            repaired = repair_reference_subtitle_text(repaired, reference)
    return apply_domain_corrections(repaired)


def apply_aligned_subtitle_result(subtitles, index, item, target):
    placeholders = target.get("placeholders") or {}
    reference_text = restore_preserved_terms(
        str(target.get("reference_text") or ""),
        placeholders
    )
    zh_text = str(item.get("zh") or "").strip()
    en_text = str(item.get("en") or "").strip()
    changed = False
    if zh_text:
        restored_text = restore_preserved_terms(zh_text, placeholders)
        subtitles[index]["zh"] = repair_subtitle_text_with_sources(
            restored_text,
            reference_text,
            en_text,
        )
        changed = True
    if en_text:
        restored_text = restore_preserved_terms(en_text, placeholders)
        subtitles[index]["en"] = repair_reference_subtitle_text(restored_text, reference_text)
        changed = True
    if subtitles[index].get("zh"):
        subtitles[index]["text"] = subtitles[index]["zh"]
    elif subtitles[index].get("en"):
        subtitles[index]["text"] = subtitles[index]["en"]
    return changed


def repair_alignment_protected_terms_with_llm(subtitles, repair_targets, provider, client, model, source_language="", batch_size=12):
    if not repair_targets:
        return subtitles, 0

    emit_stage("subtitle_align_repair", f"正在修复 {len(repair_targets)} 条字幕中的英文专有名词")
    prompt_template = """
你是一名专业字幕修复师。下面 JSON 数组里每一条字幕已经完成 ASR 时间轴对齐，但 zh 字段可能把当前口播里的英文专有名词、品牌、人名、活动名、ticker 或缩写翻译成了中文。

源语言提示：{source_language}

修复规则：
1. 严格保留数组条数不变，保持 index 和 time 原值。
2. `protected_terms` 是当前 ASR 时间片里应原样保留的英文术语；这些词在 zh 字段中必须按原英文出现，不要翻译、意译或改写大小写。
3. 只修复当前时间片，不要把 reference_text 中相邻时间片的内容扩写进本条。
4. 可以翻译普通功能词和上下文说明，但不能改动时间轴。
5. 输出纯 JSON 数组，不要 markdown 或说明。

输入 JSON：
{payload}

输出 JSON 结构：
[
  {{
    "index": 0,
    "time": [0.0, 1.2],
    "zh": "修复后的中文字幕",
    "en": "Natural English subtitle"
  }}
]
""".strip()

    repaired_count = 0
    for batch in chunked(repair_targets, batch_size):
        prompt = prompt_template.format(
            source_language=source_language or "auto",
            payload=json.dumps(batch, ensure_ascii=False)
        )
        response = generate_content(
            client,
            model=model,
            contents=prompt,
            response_mime_type="application/json",
            provider=provider
        )
        results = parse_json_array_from_text(getattr(response, "text", response))
        target_lookup = {item["index"]: item for item in batch if isinstance(item, dict) and "index" in item}
        for item in results:
            if not isinstance(item, dict):
                continue
            try:
                index = int(item.get("index"))
            except (TypeError, ValueError):
                continue
            target = target_lookup.get(index)
            if not target or not (0 <= index < len(subtitles)):
                continue
            if apply_aligned_subtitle_result(subtitles, index, item, target):
                zh_text = str(subtitles[index].get("zh") or subtitles[index].get("text") or "")
                missing = find_missing_protected_terms(zh_text, target.get("protected_terms") or [])
                if not missing:
                    repaired_count += 1
                else:
                    print(f"   ⚠️ 字幕 {index} 仍缺少英文术语: {missing}")

    if repaired_count:
        print(f"   ✅ 已用大模型修复英文术语字幕: {repaired_count}/{len(repair_targets)}")
    return subtitles, repaired_count


def align_subtitles_with_reference(subtitles, reference_subtitles, source_language="", batch_size=24):
    if not reference_subtitles:
        return subtitles

    targets = []
    for index, entry in enumerate(subtitles):
        time_range = entry.get("time")
        if not isinstance(time_range, list) or len(time_range) < 2:
            continue
        start = parse_seconds(time_range[0], milliseconds=False)
        end = parse_seconds(time_range[1], milliseconds=False)
        if start is None or end is None or end <= start:
            continue

        asr_text = str(entry.get("zh") or entry.get("text") or entry.get("en") or "").strip()
        reference_text = select_reference_context_for_asr(
            summarize_reference_context(reference_subtitles, start, end),
            asr_text
        )
        if not asr_text and not reference_text:
            continue

        reference_protected_terms = select_present_reference_terms(asr_text, reference_text, max_terms=8)
        preserve_terms = reference_protected_terms + [
            term for term in build_protected_terms(asr_text, max_terms=12)
            if term not in reference_protected_terms
        ]
        preserve_terms = preserve_terms[:12]
        protected_terms = preserve_terms[:8]
        masked_asr_text, placeholders = mask_preserved_terms(asr_text or reference_text, preserve_terms)
        masked_reference_text, _ = mask_preserved_terms(reference_text, preserve_terms)
        targets.append({
            "index": index,
            "time": [start, end],
            "asr_text": masked_asr_text,
            "reference_text": masked_reference_text,
            "placeholders": placeholders,
            "protected_terms": protected_terms,
            "source_language": source_language
        })

    if not targets:
        return subtitles

    emit_stage("subtitle_align", f"正在结合 ASR 时间轴与参考字幕对齐 {len(targets)} 条字幕")
    provider = get_text_llm_provider()
    client = create_llm_client(provider=provider)
    model = get_text_model_for_provider(provider)
    prompt_template = load_prompt_text("run_asr_skill.md", "Reference Align Prompt")
    prompt_template = (
        prompt_template
        + "\n\n补充要求：payload 中的 placeholders 映射只是候选保护项。"
        + "只有当映射值是真实专有名词、公司/产品/协议名称、ticker、股票代码、常用缩写、法案名或账号名时，zh 才可以保留对应 [[TERM_n]]。"
        + "如果映射值是普通英文单词、连接词、语气词、序数词、描述性短语或句首过渡词，zh 必须翻译成简体中文，不要输出该占位符。"
        + "即使映射值是候选专有名词，只要它在中文财经/科技/加密语境里有稳定通用中文译名，zh 必须使用中文译名，不要输出该占位符。"
        + "孤立单字母、残缺英文片段、ASR 听错的英文碎片，除非是明确 ticker、股票代码、常用缩写或账号名，否则必须结合上下文纠正、翻译或删去。"
        + "zh 最终文本禁止出现被中文标点、空格或句首句尾孤立包围的单个拉丁字母。"
        + "reference_text 可能仍包含相邻小句；必须以 asr_text 的当前时间片为范围，只纠正当前片段，不要把前后相邻片段内容扩进本条。"
        + "如果 asr_text 是逗号前后的小句、短语或单个专有名词，zh 也必须保持同等范围和节奏。"
        + "payload 中的 protected_terms 是从当前 ASR 时间片自动抽取的英文专有名词/缩写/人名/活动名；如果当前口播确实包含这些词，zh 中必须原样保留这些英文词，不要翻译成中文。"
    )

    updated_count = 0
    repair_targets = []
    for batch in chunked(targets, batch_size):
        prompt = prompt_template.format(
            source_language=source_language or "auto",
            payload=json.dumps(batch, ensure_ascii=False)
        )
        response = generate_content(
            client,
            model=model,
            contents=prompt,
            response_mime_type="application/json",
            provider=provider
        )
        results = parse_json_array_from_text(getattr(response, "text", response))
        target_lookup = {item["index"]: item for item in batch if isinstance(item, dict) and "index" in item}
        for item in results:
            if not isinstance(item, dict):
                continue
            try:
                index = int(item.get("index"))
            except (TypeError, ValueError):
                continue
            if not (0 <= index < len(subtitles)):
                continue
            target = target_lookup.get(index, {})
            apply_aligned_subtitle_result(subtitles, index, item, target)
            missing_terms = find_missing_protected_terms(
                subtitles[index].get("zh") or subtitles[index].get("text") or "",
                target.get("protected_terms") or []
            )
            if missing_terms:
                repair_targets.append({
                    "index": index,
                    "time": target.get("time") or subtitles[index].get("time"),
                    "zh": subtitles[index].get("zh") or subtitles[index].get("text") or "",
                    "en": subtitles[index].get("en") or "",
                    "asr_text": restore_preserved_terms(str(target.get("asr_text") or ""), target.get("placeholders") or {}),
                    "reference_text": restore_preserved_terms(str(target.get("reference_text") or ""), target.get("placeholders") or {}),
                    "protected_terms": target.get("protected_terms") or [],
                    "missing_protected_terms": missing_terms,
                    "placeholders": {},
                })
            updated_count += 1

    if repair_targets:
        subtitles, _repaired_count = repair_alignment_protected_terms_with_llm(
            subtitles,
            repair_targets,
            provider,
            client,
            model,
            source_language=source_language,
        )

    print(f"   ✅ 已结合参考字幕对齐: {updated_count}/{len(targets)}")
    return subtitles


def split_reference_text_for_authority(text, split_config=None):
    split_config = resolve_split_config(split_config)
    sample = apply_domain_corrections(str(text or "").strip())
    if not sample:
        return []

    display_limit = reference_authority_display_limit(sample, split_config)
    chunks = []
    for piece in split_text_by_clause_boundaries(sample):
        chunks.extend(split_long_text_piece(piece, display_limit))
    return [apply_domain_corrections(chunk) for chunk in chunks if visible_text(chunk)]


def visible_text_with_indices(text):
    visible_chars = []
    indices = []
    for index, char in enumerate(str(text or "")):
        if visible_text(char):
            visible_chars.append(char.lower())
            indices.append(index)
    return "".join(visible_chars), indices


def common_prefix_length(left, right):
    count = 0
    max_len = min(len(left or ""), len(right or ""))
    while count < max_len and left[count] == right[count]:
        count += 1
    return count


def common_suffix_length(left, right):
    count = 0
    left = left or ""
    right = right or ""
    max_len = min(len(left), len(right))
    while count < max_len and left[-(count + 1)] == right[-(count + 1)]:
        count += 1
    return count


def find_asr_anchor_visible_position(reference_visible, asr_text):
    sample = visible_text(asr_text).lower()
    reference = str(reference_visible or "")
    if len(sample) < 3 or not reference:
        return -1

    max_len = min(len(sample), 14)
    for size in range(max_len, 2, -1):
        anchor = sample[:size]
        if not re.search(r"[\u4e00-\u9fff0-9A-Za-z]", anchor):
            continue
        position = reference.find(anchor)
        if position >= 0:
            return position
    return -1


def visible_position_to_char_index(indices, visible_position):
    if not indices:
        return 0
    if visible_position <= 0:
        return 0
    if visible_position >= len(indices):
        return indices[-1] + 1
    return indices[visible_position - 1] + 1


def extend_boundary_over_numeric_and_punctuation(text, end_index, asr_text):
    sample = str(text or "")
    end = max(0, min(len(sample), int(end_index or 0)))

    if re.search(r"\d", str(asr_text or "")):
        numeric_match = re.search(
            r"[$￥¥]?\d+(?:[.,]\d+)*(?:\s*(?:million|billion|trillion|thousand|hundred|mn|bn|m|b|k))?"
            r"(?:(?:万|亿|千|百)?(?:美元|美分|元)|[万亿千百%年个次股]|(?:\s*(?:dollars?|usd|美元|美金|元)))?",
            sample[end:],
            flags=re.IGNORECASE
        )
        if numeric_match and numeric_match.start() <= 2:
            end += numeric_match.end()

    while end < len(sample) and sample[end] in "，,。.!?！？；;：:、":
        end += 1
    return end


REFERENCE_AUTHORITY_NUMERIC_PATTERN = re.compile(
    r"[$￥¥]?\d+(?:[.,]\d+)*"
    r"(?:\s*(?:million|billion|trillion|thousand|hundred|mn|bn|m|b|k))?"
    r"(?:(?:万|亿|千|百)?(?:美元|美分|元)|[万亿千百%年个次股]|(?:\s*(?:dollars?|usd|美元|美金|元)))?",
    re.IGNORECASE,
)


def numeric_term_value(term):
    sample = str(term or "").lower().replace(",", "")
    match = re.search(r"\d+(?:\.\d+)?", sample)
    if not match:
        return None
    value = float(match.group(0))
    suffix = sample[match.end():]
    multiplier = 1.0
    if re.search(r"billion|bn|\bb\b", suffix):
        multiplier = 1_000_000_000.0
    elif re.search(r"million|mn|\bm\b", suffix):
        multiplier = 1_000_000.0
    elif re.search(r"thousand|\bk\b", suffix):
        multiplier = 1_000.0
    elif "亿" in suffix:
        multiplier = 100_000_000.0
    elif "万" in suffix:
        multiplier = 10_000.0
    elif "千" in suffix:
        multiplier = 1_000.0
    elif "百" in suffix or "hundred" in suffix:
        multiplier = 100.0
    return value * multiplier


def numeric_values_equivalent(left, right):
    left_value = numeric_term_value(left)
    right_value = numeric_term_value(right)
    if left_value is None or right_value is None:
        return False
    tolerance = max(1.0, abs(left_value) * 0.001, abs(right_value) * 0.001)
    return abs(left_value - right_value) <= tolerance


def find_equivalent_reference_numeric_match(reference_text, asr_text):
    asr_matches = list(REFERENCE_AUTHORITY_NUMERIC_PATTERN.finditer(str(asr_text or "")))
    if not asr_matches:
        return None
    ref_matches = list(REFERENCE_AUTHORITY_NUMERIC_PATTERN.finditer(str(reference_text or "")))
    for asr_match in reversed(asr_matches):
        asr_term = asr_match.group(0)
        for ref_match in ref_matches:
            ref_term = ref_match.group(0)
            if numeric_values_equivalent(ref_term, asr_term):
                return ref_match
    return None


def find_natural_boundary_near_visible_length(text, target_visible_len, remaining_segments):
    sample = str(text or "")
    ref_visible, indices = visible_text_with_indices(sample)
    if not ref_visible:
        return len(sample)

    remaining_visible = len(ref_visible)
    leave_visible = max(0, int(remaining_segments or 0))
    target = max(1, min(int(target_visible_len or 1), remaining_visible - leave_visible))
    if target <= 0:
        return 0

    candidates = []
    for index, char in enumerate(sample):
        if char not in "，,。.!?！？；;：:、":
            continue
        visible_before = len(visible_text(sample[:index + 1]))
        if 0 < visible_before <= remaining_visible - leave_visible:
            candidates.append((abs(visible_before - target), index + 1))
    if candidates:
        candidates.sort(key=lambda item: item[0])
        return candidates[0][1]

    return visible_position_to_char_index(indices, target)


def find_reference_boundary_for_asr_segment(text, asr_text, next_asr_text, remaining_segments):
    sample = str(text or "")
    ref_visible, indices = visible_text_with_indices(sample)
    if not ref_visible:
        return len(sample)

    numeric_match = find_equivalent_reference_numeric_match(sample, asr_text)
    if numeric_match:
        return extend_boundary_over_numeric_and_punctuation(sample, numeric_match.end(), asr_text)

    if next_asr_text:
        next_position = find_asr_anchor_visible_position(ref_visible, next_asr_text)
        if next_position > 0:
            return visible_position_to_char_index(indices, next_position)

    asr_visible = visible_text(asr_text).lower()
    prefix_len = common_prefix_length(asr_visible, ref_visible)
    if prefix_len >= 2:
        end = visible_position_to_char_index(indices, prefix_len)
        return extend_boundary_over_numeric_and_punctuation(sample, end, asr_text)

    return find_natural_boundary_near_visible_length(
        sample,
        max(4, len(asr_visible)),
        remaining_segments
    )


def split_reference_text_by_asr_segments(reference_text, asr_entries):
    sample = apply_domain_corrections(str(reference_text or "").strip())
    if not sample:
        return []
    if not asr_entries or len(asr_entries) <= 1:
        return [sample]

    pieces = []
    remaining = sample
    for index, entry in enumerate(asr_entries):
        remaining = remaining.lstrip()
        if not remaining:
            break
        if index == len(asr_entries) - 1:
            pieces.append(apply_domain_corrections(remaining.strip()))
            remaining = ""
            break

        asr_text = get_subtitle_primary_text(entry)
        next_asr_text = get_subtitle_primary_text(asr_entries[index + 1])
        boundary = find_reference_boundary_for_asr_segment(
            remaining,
            asr_text,
            next_asr_text,
            len(asr_entries) - index - 1
        )
        if boundary <= 0:
            continue
        current = apply_domain_corrections(remaining[:boundary].strip())
        if current:
            pieces.append(current)
        remaining = remaining[boundary:]

    if remaining.strip():
        tail = apply_domain_corrections(remaining.strip())
        if pieces:
            pieces[-1] = apply_domain_corrections(f"{pieces[-1]}{tail}")
        else:
            pieces.append(tail)

    return [piece for piece in pieces if visible_text(piece)]


def subtitle_time_range(entry):
    if not isinstance(entry, dict):
        return None
    time_range = entry.get("time")
    if not isinstance(time_range, list) or len(time_range) < 2:
        time_range = [entry.get("start"), entry.get("end")]
    start = parse_seconds(time_range[0], milliseconds=False)
    end = parse_seconds(time_range[1], milliseconds=False)
    if start is None or end is None or end <= start:
        return None
    return start, end


def build_reference_authority_entries(asr_entries, reference_chunks, reference_entry=None, split_config=None):
    if not asr_entries or not reference_chunks:
        return []

    output = []
    reference_text = "".join(reference_chunks)
    pieces = split_reference_text_by_asr_segments(reference_text, asr_entries)
    for asr_entry, chunk in zip(asr_entries, pieces):
        time_range = subtitle_time_range(asr_entry)
        if not time_range:
            continue
        if not chunk:
            continue
        output.append({
            "time": [time_range[0], time_range[1]],
            "zh": chunk,
            "text": chunk,
        })
    return output


def split_reference_authority_entries_for_display(entries, split_config=None):
    split_config = resolve_split_config(split_config)
    output = []
    for entry in normalize_final_subtitles(entries):
        text = get_subtitle_primary_text(entry)
        if reference_authority_text_fits_display(text, split_config):
            output.append(entry)
            continue
        pieces = split_reference_text_for_authority(text, split_config)
        if len(pieces) <= 1:
            output.append(entry)
            continue
        start, end = subtitle_time_range(entry)
        weights = [max(1, readable_visible_len(piece)) for piece in pieces]
        total_weight = max(1, sum(weights))
        cursor = start
        for index, piece in enumerate(pieces):
            piece_end = end if index == len(pieces) - 1 else cursor + ((end - start) * weights[index] / total_weight)
            output.append({
                **entry,
                "time": [round(cursor, 2), round(piece_end, 2)],
                "zh": piece,
                "text": piece,
            })
            cursor = piece_end
    return normalize_final_subtitles(output)


def clamp_reference_authority_timing(
    entries,
    reference_entry,
    previous_end=None,
    tolerance_seconds=0.35,
    prefer_asr_timing=False,
):
    if not entries:
        return entries

    ref_time = subtitle_time_range(reference_entry)
    if not ref_time:
        return entries

    ref_start, ref_end = ref_time
    clamped = [dict(entry) for entry in entries]
    first_time = subtitle_time_range(clamped[0])
    if first_time:
        first_start, first_end = first_time
        min_start = ref_start
        if previous_end is not None:
            min_start = max(min_start, float(previous_end))
        should_clamp_start = first_start < min_start
        if not prefer_asr_timing:
            should_clamp_start = (
                previous_end is not None
                or should_clamp_start
                or first_start - min_start > tolerance_seconds
            )
        if should_clamp_start and first_start != min_start and first_end > min_start:
            clamped[0]["time"] = [round(min_start, 2), first_end]

    last_time = subtitle_time_range(clamped[-1])
    if last_time:
        last_start, last_end = last_time
        if not prefer_asr_timing and ref_end - last_end > tolerance_seconds and ref_end > last_start:
            clamped[-1]["time"] = [last_start, round(ref_end, 2)]
        elif last_end > ref_end and ref_end > last_start:
            clamped[-1]["time"] = [last_start, round(ref_end, 2)]

    return clamped


READABLE_LEADING_PUNCTUATION = "，,。.!?！？；;：:、"
READABLE_SENTENCE_PUNCTUATION = "。.!?！？；;"
READABLE_MIN_VISIBLE_CHARS = 6
READABLE_TARGET_VISIBLE_CHARS = 18
READABLE_HARD_VISIBLE_CHARS = 30
READABLE_ATOM_TARGET_VISIBLE_CHARS = 24
REFERENCE_AUTHORITY_TWO_LINE_VISIBLE_CHARS = 24
READABLE_LATIN_HARD_VISIBLE_CHARS = 36
REFERENCE_AUTHORITY_MICRO_FRAGMENT_MAX_DURATION_SECONDS = 0.45
REFERENCE_AUTHORITY_MICRO_FRAGMENT_MAX_GAP_SECONDS = 0.28
REFERENCE_AUTHORITY_MICRO_FRAGMENT_MAX_VISIBLE_CHARS = 2
REFERENCE_AUTHORITY_NEXT_PREFIX_MAX_GAP_SECONDS = 0.75
REFERENCE_AUTHORITY_NEXT_PREFIX_MAX_VISIBLE_CHARS = 12


def set_subtitle_primary_text(entry, text):
    updated = dict(entry)
    cleaned = apply_domain_corrections(str(text or "").strip())
    if str(updated.get("zh") or "").strip() or not str(updated.get("en") or "").strip():
        updated["zh"] = cleaned
    updated["text"] = cleaned
    return updated


def append_display_punctuation(text, punctuation):
    left = str(text or "").rstrip()
    right = str(punctuation or "")
    if not right:
        return left
    if left and left[-1] in READABLE_LEADING_PUNCTUATION and right[-1:] == left[-1]:
        return left
    return f"{left}{right}"


def move_leading_punctuation_to_previous(entries):
    normalized = []
    for entry in normalize_final_subtitles(entries):
        text = get_subtitle_primary_text(entry)
        match = re.match(rf"^[{re.escape(READABLE_LEADING_PUNCTUATION)}]+", text)
        if not match or not normalized:
            normalized.append(entry)
            continue

        punctuation = match.group(0)
        rest = text[match.end():].strip()
        previous_text = get_subtitle_primary_text(normalized[-1])
        normalized[-1] = set_subtitle_primary_text(
            normalized[-1],
            append_display_punctuation(previous_text, punctuation)
        )
        if rest:
            normalized.append(set_subtitle_primary_text(entry, rest))
        else:
            normalized[-1] = merge_subtitle_entries(normalized[-1], entry)
    return normalized


def subtitle_duration(entry):
    time_range = subtitle_time_range(entry)
    if not time_range:
        return 0.0
    return max(0.0, time_range[1] - time_range[0])


def normalize_reference_authority_asr_entry(entry):
    time_range = subtitle_time_range(entry)
    text = get_subtitle_primary_text(entry)
    if not time_range or not text:
        return None
    normalized = dict(entry)
    normalized["time"] = [time_range[0], time_range[1]]
    if not str(normalized.get("zh") or "").strip():
        normalized["zh"] = text
    normalized["text"] = text
    return normalized


def is_reference_authority_micro_asr_fragment(entry):
    duration = subtitle_duration(entry)
    if duration <= 0 or duration > REFERENCE_AUTHORITY_MICRO_FRAGMENT_MAX_DURATION_SECONDS:
        return False
    text = get_subtitle_primary_text(entry)
    visible_len = readable_visible_len(text)
    if visible_len <= REFERENCE_AUTHORITY_MICRO_FRAGMENT_MAX_VISIBLE_CHARS:
        return True
    return visible_len <= 3 and not has_latin_text(text)


def merge_reference_authority_asr_entries(previous, current):
    previous_time = subtitle_time_range(previous)
    current_time = subtitle_time_range(current)
    if not previous_time or not current_time:
        return previous
    merged = dict(previous)
    merged["time"] = [previous_time[0], current_time[1]]
    merged_text = apply_domain_corrections(join_subtitle_text(
        get_subtitle_primary_text(previous),
        get_subtitle_primary_text(current),
    ))
    merged["zh"] = merged_text
    merged["text"] = merged_text
    return merged


def merge_reference_authority_micro_asr_fragments(asr_entries):
    output = []
    for entry in asr_entries or []:
        normalized = normalize_reference_authority_asr_entry(entry)
        if not normalized:
            continue
        if output and is_reference_authority_micro_asr_fragment(normalized):
            previous_time = subtitle_time_range(output[-1])
            current_time = subtitle_time_range(normalized)
            gap = current_time[0] - previous_time[1] if previous_time and current_time else 0
            if -0.03 <= gap <= REFERENCE_AUTHORITY_MICRO_FRAGMENT_MAX_GAP_SECONDS:
                output[-1] = merge_reference_authority_asr_entries(output[-1], normalized)
                continue
        output.append(normalized)
    return output


def readable_visible_len(text):
    return len(visible_text(text))


def has_latin_text(text):
    return bool(re.search(r"[A-Za-z]", str(text or "")))


def is_latin_only_fragment(text):
    sample = str(text or "").strip().strip(READABLE_LEADING_PUNCTUATION)
    return bool(sample and has_latin_text(sample) and not has_cjk(sample))


def ends_with_latin_token(text):
    return bool(re.search(r"[A-Za-z0-9][A-Za-z0-9.'’$%+-]*\s*$", str(text or "")))


def starts_with_cjk_text(text):
    return bool(re.match(rf"^[{re.escape(READABLE_LEADING_PUNCTUATION)}\s]*[\u4e00-\u9fff]", str(text or "")))


def ends_with_sentence_punctuation(text):
    return str(text or "").rstrip().endswith(tuple(READABLE_SENTENCE_PUNCTUATION))


def combined_readable_limit(left_text, right_text):
    if has_latin_text(left_text) or has_latin_text(right_text):
        return READABLE_LATIN_HARD_VISIBLE_CHARS
    return READABLE_HARD_VISIBLE_CHARS


def reference_authority_display_limit(text="", split_config=None):
    split_config = resolve_split_config(split_config)
    configured_limit = max(8, int(split_config["max_visible_chars"]))
    latin_visible = len(re.findall(r"[A-Za-z]", visible_text(text)))
    if latin_visible >= 18:
        return READABLE_LATIN_HARD_VISIBLE_CHARS
    if has_cjk(text):
        return min(REFERENCE_AUTHORITY_TWO_LINE_VISIBLE_CHARS, configured_limit)
    return min(REFERENCE_AUTHORITY_TWO_LINE_VISIBLE_CHARS, configured_limit)


def reference_authority_text_fits_display(text, split_config=None):
    return readable_visible_len(text) <= reference_authority_display_limit(text, split_config)


def can_merge_readable_entries(left, right):
    left_text = get_subtitle_primary_text(left)
    right_text = get_subtitle_primary_text(right)
    combined_len = readable_visible_len(join_subtitle_text(left_text, right_text))
    return combined_len <= combined_readable_limit(left_text, right_text)


def is_low_information_subtitle(entry):
    text = get_subtitle_primary_text(entry)
    length = readable_visible_len(text)
    if length <= 0:
        return False
    if length <= READABLE_MIN_VISIBLE_CHARS and not ends_with_sentence_punctuation(text):
        return True
    if subtitle_duration(entry) < 0.95 and length <= READABLE_TARGET_VISIBLE_CHARS:
        return True
    if is_latin_only_fragment(text) and length <= READABLE_LATIN_HARD_VISIBLE_CHARS:
        return True
    return False


def should_merge_readable_forward(current, next_entry):
    if not next_entry or not can_merge_readable_entries(current, next_entry):
        return False

    current_text = get_subtitle_primary_text(current)
    next_text = get_subtitle_primary_text(next_entry)
    current_len = readable_visible_len(current_text)
    next_len = readable_visible_len(next_text)

    if is_low_information_subtitle(current):
        return True
    if is_latin_only_fragment(current_text) and starts_with_cjk_text(next_text):
        return True
    if ends_with_latin_token(current_text) and starts_with_cjk_text(next_text) and next_len <= 10:
        return True
    if current_len <= READABLE_MIN_VISIBLE_CHARS and not ends_with_sentence_punctuation(current_text):
        return True
    return False


def should_merge_readable_backward(previous, current):
    if not previous or not can_merge_readable_entries(previous, current):
        return False

    current_text = get_subtitle_primary_text(current)
    previous_text = get_subtitle_primary_text(previous)
    current_len = readable_visible_len(current_text)

    if current_len <= READABLE_MIN_VISIBLE_CHARS and not ends_with_sentence_punctuation(previous_text):
        return True
    if subtitle_duration(current) < 0.95 and current_len <= READABLE_TARGET_VISIBLE_CHARS:
        return True
    if starts_with_cjk_text(current_text) and ends_with_latin_token(previous_text) and current_len <= 14:
        return True
    return False


def ends_with_dangling_subtitle_phrase(text):
    sample = str(text or "").rstrip()
    if not sample:
        return False
    if sample.endswith(tuple(READABLE_SENTENCE_PUNCTUATION)):
        return False
    return bool(re.search(
        r"(会|将|要|能|能够|可以|正在|开始|继续|创造|承认|意味着|等于|来自|成为|进入|推动|推高|"
        r"和|与|及|以及|或|或者|并|但|而|因为|所以|如果|就是|只是|不是|"
        r"的|了|把|被|对|在|从|向|给|由|比)$",
        sample,
    ))


def split_next_subtitle_prefix_for_completion(text):
    sample = str(text or "").strip()
    if not sample:
        return "", ""
    pieces = split_text_by_clause_boundaries(sample)
    if len(pieces) <= 1:
        return sample, ""
    prefix = pieces[0]
    rest = sample[len(prefix):].strip()
    return prefix, rest


def repair_dangling_subtitle_endings(entries):
    output = [dict(entry) for entry in normalize_final_subtitles(entries)]
    changed = False
    index = 0
    while index + 1 < len(output):
        current = output[index]
        next_entry = output[index + 1]
        current_text = get_subtitle_primary_text(current)
        if not ends_with_dangling_subtitle_phrase(current_text):
            index += 1
            continue

        next_text = get_subtitle_primary_text(next_entry)
        prefix, rest = split_next_subtitle_prefix_for_completion(next_text)
        if not prefix:
            index += 1
            continue

        combined_text = join_subtitle_text(current_text, prefix)
        if readable_visible_len(combined_text) > combined_readable_limit(current_text, prefix):
            index += 1
            continue

        current_start, current_end = subtitle_time_range(current)
        next_start, next_end = subtitle_time_range(next_entry)
        if rest:
            next_visible = max(1, readable_visible_len(next_text))
            prefix_visible = max(1, readable_visible_len(prefix))
            split_time = next_start + ((next_end - next_start) * prefix_visible / next_visible)
            split_time = round(min(next_end, max(next_start, split_time)), 2)
            if split_time <= next_start or split_time >= next_end:
                index += 1
                continue
            output[index] = set_subtitle_primary_text(
                {**current, "time": [current_start, split_time]},
                combined_text,
            )
            output[index + 1] = set_subtitle_primary_text(
                {**next_entry, "time": [split_time, next_end]},
                rest,
            )
        else:
            output[index] = set_subtitle_primary_text(
                {**current, "time": [current_start, next_end]},
                combined_text,
            )
            output.pop(index + 1)
        changed = True

    if changed:
        print("   ✅ 已修复字幕动宾/连词断行")
    return normalize_final_subtitles(output)


def merge_readable_neighbors(entries):
    output = []
    index = 0
    normalized = normalize_final_subtitles(entries)
    while index < len(normalized):
        current = normalized[index]
        index += 1

        while index < len(normalized) and should_merge_readable_forward(current, normalized[index]):
            current = merge_subtitle_entries(current, normalized[index])
            index += 1

        if output and should_merge_readable_backward(output[-1], current):
            output[-1] = merge_subtitle_entries(output[-1], current)
        else:
            output.append(current)
    return output


def split_readable_text_piece(text, max_visible_chars=READABLE_HARD_VISIBLE_CHARS):
    sample = str(text or "").strip()
    if readable_visible_len(sample) <= max_visible_chars:
        return [sample] if sample else []

    pieces = split_text_by_clause_boundaries(sample)
    if len(pieces) <= 1:
        return [sample]

    output = []
    pending = ""
    for piece in pieces:
        candidate = join_subtitle_text(pending, piece) if pending else piece
        if pending and readable_visible_len(candidate) > max_visible_chars:
            output.append(pending)
            pending = piece
        else:
            pending = candidate
    if pending:
        output.append(pending)

    balanced = []
    for piece in output:
        if readable_visible_len(piece) < READABLE_MIN_VISIBLE_CHARS and balanced:
            balanced[-1] = join_subtitle_text(balanced[-1], piece)
        else:
            balanced.append(piece)
    if len(balanced) > 1 and readable_visible_len(balanced[0]) < READABLE_MIN_VISIBLE_CHARS:
        balanced[1] = join_subtitle_text(balanced[0], balanced[1])
        balanced = balanced[1:]
    return [piece for piece in balanced if visible_text(piece)]


def split_long_readable_entries(entries):
    output = []
    for entry in normalize_final_subtitles(entries):
        text = get_subtitle_primary_text(entry)
        max_visible_chars = combined_readable_limit(text, "")
        if readable_visible_len(text) <= max_visible_chars or subtitle_duration(entry) <= 2.2:
            output.append(entry)
            continue

        pieces = split_readable_text_piece(text, max_visible_chars=max_visible_chars)
        if len(pieces) <= 1:
            output.append(entry)
            continue

        start, end = subtitle_time_range(entry)
        weights = [max(1, readable_visible_len(piece)) for piece in pieces]
        total_weight = max(1, sum(weights))
        cursor = start
        for index, piece in enumerate(pieces):
            piece_end = end if index == len(pieces) - 1 else cursor + ((end - start) * weights[index] / total_weight)
            output.append(set_subtitle_primary_text(
                {**entry, "time": [round(cursor, 2), round(piece_end, 2)]},
                piece
            ))
            cursor = piece_end
    return output


def subtitle_readability_issues(entries):
    issues = []
    for index, entry in enumerate(entries):
        text = get_subtitle_primary_text(entry)
        if re.match(rf"^[{re.escape(READABLE_LEADING_PUNCTUATION)}]", text):
            issues.append((index, "leading_punctuation", text))
        if ends_with_dangling_subtitle_phrase(text):
            issues.append((index, "dangling_phrase", text))
        if is_low_information_subtitle(entry):
            issues.append((index, "low_information", text))
    return issues


def polish_readable_subtitle_segments(entries, split_config=None, use_llm=True):
    """Improve display grouping while keeping each subtitle inside its original timed span."""

    if not entries:
        return []

    polished = move_leading_punctuation_to_previous(entries)
    polished = merge_readable_neighbors(polished)
    polished = repair_dangling_subtitle_endings(polished)
    polished = move_leading_punctuation_to_previous(polished)
    polished = merge_readable_neighbors(polished)
    if use_llm:
        polished = split_long_readable_entries(polished)
        polished = move_leading_punctuation_to_previous(polished)
        polished = merge_readable_neighbors(polished)
        polished = repair_dangling_subtitle_endings(polished)
        polished = move_leading_punctuation_to_previous(polished)
        polished = merge_readable_neighbors(polished)
    polished = normalize_final_subtitles(polished)

    issues = subtitle_readability_issues(polished)
    if len(polished) != len(entries) or issues:
        print(f"   ✅ 已优化字幕阅读分组: {len(entries)} -> {len(polished)} 条")
    return polished


REFERENCE_AUTHORITY_GROUP_MAX_DURATION_SECONDS = 8.0
REFERENCE_AUTHORITY_MAX_INTERNAL_GAP_SECONDS = 0.65
REFERENCE_AUTHORITY_MAX_CONTINUOUS_GAP_SECONDS = 3.25
REFERENCE_AUTHORITY_MAX_TAIL_EXTENSION_SECONDS = 6.0


class ReferenceAuthorityAlignmentError(RuntimeError):
    """Raised when reference-text-authority subtitles cannot be safely verified."""

    code = "REFERENCE_AUTHORITY_ALIGNMENT_FAILED"
    stage = "subtitle_reference_authority"
    message = "参考文本字幕时间轴未通过严格校验"
    hint = "系统会重试 ASR 与参考文本分配；如果持续失败，请检查口播稿是否对应最终成片音频。"

    def __init__(self, details):
        super().__init__(details)
        self.details = str(details or self.message)


def append_reference_authority_debug_event(event):
    debug_path = Path("reference_authority_debug.json")
    try:
        existing = json.loads(debug_path.read_text(encoding="utf-8")) if debug_path.exists() else []
        if not isinstance(existing, list):
            existing = []
    except Exception:
        existing = []
    payload = dict(event or {})
    payload["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    existing.append(payload)
    debug_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")


def reference_authority_asr_debug_segments(asr_entries):
    return [
        {
            "index": index,
            "time": list(subtitle_time_range(entry) or []),
            "asr_text": get_subtitle_primary_text(entry),
        }
        for index, entry in enumerate(asr_entries or [])
    ]


def append_reference_authority_fallback_debug_event(
    fallback_stage,
    reason,
    reference_text="",
    asr_entries=None,
    fallback_entries=None,
    details=None,
):
    payload = {
        "event_type": "reference_authority_fallback",
        "fallback_stage": fallback_stage,
        "reason": str(reason or ""),
        "reference_text": apply_domain_corrections(str(reference_text or "").strip()),
        "asr_segments": reference_authority_asr_debug_segments(asr_entries or []),
        "fallback_entries_count": len(fallback_entries or []),
    }
    if details:
        payload["details"] = details
    append_reference_authority_debug_event(payload)


def visible_len_between(text, start_index, end_index):
    return len(visible_text(str(text or "")[max(0, start_index):max(0, end_index)]))


def parse_reference_authority_index(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def parse_reference_authority_group_span(item):
    if not isinstance(item, dict):
        return None

    indices = item.get("indices") or item.get("asr_indices")
    if isinstance(indices, list) and indices:
        parsed = [parse_reference_authority_index(value) for value in indices]
        if any(value is None for value in parsed):
            return None
        parsed = sorted(parsed)
        if parsed != list(range(parsed[0], parsed[-1] + 1)):
            return None
        return parsed[0], parsed[-1]

    start = None
    for key in ("start_index", "start", "from_index", "from", "first_index"):
        if key in item:
            start = parse_reference_authority_index(item.get(key))
            break

    end = None
    for key in ("end_index", "end", "to_index", "to", "last_index"):
        if key in item:
            end = parse_reference_authority_index(item.get(key))
            break

    if start is None and end is None:
        return None
    if start is None:
        start = end
    if end is None:
        end = start
    return start, end


def reference_position_hint_matches(item, reference, start_position, end_position, tolerance=2):
    span = parse_reference_authority_group_span(item)
    if span is None:
        return False
    start, end = span
    if start is None or end is None:
        return False

    visible_start = visible_len_between(reference, 0, start_position)
    visible_end = visible_len_between(reference, 0, end_position)
    start_matches = (
        abs(start - start_position) <= tolerance
        or abs(start - visible_start) <= tolerance
    )
    end_matches = (
        abs(end - end_position) <= tolerance
        or abs(end - (end_position - 1)) <= tolerance
        or abs(end - visible_end) <= tolerance
    )
    return start_matches and end_matches


def build_reference_piece_spans(reference, pieces):
    spans = []
    cursor = 0
    for index, piece in enumerate(pieces):
        text = str(piece or "")
        if not text:
            continue
        position = reference.find(text, cursor)
        if position < 0:
            return []
        spans.append({
            "index": index,
            "start": position,
            "end": position + len(text),
            "text": text,
        })
        cursor = position + len(text)
    return spans


def reference_piece_for_position(piece_spans, position, *, prefer_next=False):
    if not piece_spans:
        return None
    for piece in piece_spans:
        start = piece["start"]
        end = piece["end"]
        if position == end and not prefer_next:
            return piece
        if start <= position < end:
            return piece
        if prefer_next and position == start:
            return piece
    if position == piece_spans[-1]["end"]:
        return piece_spans[-1]
    return None


def time_at_reference_piece_offset(asr_entry, piece_text, offset):
    time_range = subtitle_time_range(asr_entry)
    if not time_range:
        return None
    start, end = time_range
    sample = str(piece_text or "")
    offset = max(0, min(len(sample), int(offset or 0)))
    total_visible = max(1, len(visible_text(sample)))
    current_visible = visible_len_between(sample, 0, offset)
    ratio = max(0.0, min(1.0, current_visible / total_visible))
    return start + ((end - start) * ratio)


def time_range_for_reference_span(asr_entries, piece_spans, start_position, end_position):
    start_piece = reference_piece_for_position(piece_spans, start_position, prefer_next=True)
    end_piece = reference_piece_for_position(piece_spans, max(start_position, end_position - 1))
    if not start_piece or not end_piece:
        return None
    start_index = start_piece["index"]
    end_index = end_piece["index"]
    if not (0 <= start_index <= end_index < len(asr_entries)):
        return None

    start_time = time_at_reference_piece_offset(
        asr_entries[start_index],
        start_piece["text"],
        start_position - start_piece["start"],
    )
    end_time = time_at_reference_piece_offset(
        asr_entries[end_index],
        end_piece["text"],
        end_position - end_piece["start"],
    )
    if start_time is None or end_time is None or end_time <= start_time:
        return None
    return start_index, end_index, round(start_time, 2), round(end_time, 2)


def update_reference_atom_time(atom, asr_entries, piece_spans):
    span_time = time_range_for_reference_span(
        asr_entries,
        piece_spans,
        atom["start_pos"],
        atom["end_pos"],
    )
    if span_time is None:
        return None
    start_index, end_index, start_time, end_time = span_time
    atom["start_asr_index"] = start_index
    atom["end_asr_index"] = end_index
    atom["time"] = [start_time, end_time]
    return atom


REFERENCE_ATOM_SPLIT_BEFORE_CHARS = "([{（【《“‘\"'"
REFERENCE_ATOM_SPLIT_AFTER_CHARS = ")]}）】》”’\"'，,、：:；;。.!?！？"


def is_latin_word_char(char):
    return bool(re.match(r"[A-Za-z0-9$%+._'-]", str(char or "")))


def is_numeric_token_split(sample, index):
    if not (0 < index < len(sample)):
        return False
    left = str(sample[:index] or "")
    right = str(sample[index:] or "")
    if re.search(r"\d[\d,.]*$", left) and re.match(r"^[\d,.]*\d%?", right):
        return True
    if re.search(r"\d$", left) and re.match(r"^%", right):
        return True
    return False


def reference_atom_boundary_priority(sample, index):
    if not (0 < index < len(sample)):
        return None
    if is_numeric_token_split(sample, index):
        return None
    previous_char = sample[index - 1]
    current_char = sample[index]
    if previous_char in "。.!?！？；;":
        return 0
    if previous_char in "，,、：:":
        return 1
    if current_char in REFERENCE_ATOM_SPLIT_BEFORE_CHARS:
        return 2
    if previous_char in REFERENCE_ATOM_SPLIT_AFTER_CHARS:
        return 2
    if (has_cjk(previous_char) and re.match(r"[$A-Za-z0-9]", current_char)) or (
        is_latin_word_char(previous_char) and has_cjk(current_char)
    ):
        return 2
    if previous_char.isspace() or current_char.isspace():
        return 3
    return None


def fallback_reference_atom_split_index(sample, max_visible_chars):
    _visible, indices = visible_text_with_indices(sample)
    if len(indices) <= max_visible_chars:
        return len(sample)
    target_visible = max_visible_chars
    tail_visible = len(indices) - target_visible
    if 0 < tail_visible < READABLE_MIN_VISIBLE_CHARS:
        target_visible = max(
            READABLE_MIN_VISIBLE_CHARS,
            len(indices) - READABLE_MIN_VISIBLE_CHARS,
        )
    split_index = indices[target_visible]
    while (
        split_index > 1
        and split_index < len(sample)
        and (
            (
                is_latin_word_char(sample[split_index - 1])
                and is_latin_word_char(sample[split_index])
            )
            or is_numeric_token_split(sample, split_index)
        )
    ):
        split_index -= 1
    if split_index <= 0:
        split_index = indices[target_visible]
    return split_index


def find_reference_atom_split_index(sample, max_visible_chars):
    if readable_visible_len(sample) <= max_visible_chars:
        return len(sample)

    minimum_left = max(READABLE_MIN_VISIBLE_CHARS, min(max_visible_chars - 2, int(max_visible_chars * 0.38)))
    candidates = []
    for index in range(1, len(sample)):
        left = sample[:index].strip()
        right = sample[index:].strip()
        if not left or not right:
            continue
        left_len = readable_visible_len(left)
        if left_len <= 0 or left_len > max_visible_chars:
            continue
        priority = reference_atom_boundary_priority(sample, index)
        if priority is None:
            continue
        candidates.append((left_len >= minimum_left, priority, abs(max_visible_chars - left_len), -left_len, index))

    preferred = [candidate for candidate in candidates if candidate[0]]
    if preferred:
        preferred.sort(key=lambda item: (item[1], item[2], item[3]))
        return preferred[0][4]
    if candidates:
        candidates.sort(key=lambda item: (item[1], item[2], item[3]))
        return candidates[0][4]
    return fallback_reference_atom_split_index(sample, max_visible_chars)


def split_long_reference_atom_piece(piece, max_visible_chars):
    sample = str(piece or "").strip()
    if not sample:
        return []

    output = []
    remaining = sample
    while readable_visible_len(remaining) > max_visible_chars:
        split_index = find_reference_atom_split_index(remaining, max_visible_chars)
        if split_index <= 0 or split_index >= len(remaining):
            output.extend(split_long_text_piece(remaining, max_visible_chars))
            return output
        current = remaining[:split_index].rstrip()
        if not current:
            output.extend(split_long_text_piece(remaining, max_visible_chars))
            return output
        output.append(current)
        remaining = remaining[split_index:].lstrip()

    if remaining:
        output.append(remaining)
    return output


def split_reference_text_for_readable_atoms(text, max_visible_chars=READABLE_ATOM_TARGET_VISIBLE_CHARS):
    sample = str(text or "").strip()
    if not sample:
        return []

    sentence_pieces = []
    start = 0
    for index, char in enumerate(sample):
        if char not in READABLE_SENTENCE_PUNCTUATION:
            continue
        piece = sample[start:index + 1].strip()
        if piece:
            sentence_pieces.append(piece)
        start = index + 1
    tail = sample[start:].strip()
    if tail:
        sentence_pieces.append(tail)

    atoms = []
    for piece in sentence_pieces or [sample]:
        if readable_visible_len(piece) <= max_visible_chars:
            atoms.append(piece)
            continue
        current = ""
        for chunk in split_text_by_clause_boundaries(piece):
            if readable_visible_len(chunk) > max_visible_chars:
                if current:
                    atoms.append(current)
                    current = ""
                atoms.extend(split_long_reference_atom_piece(chunk, max_visible_chars))
                continue
            candidate = f"{current}{chunk}" if current else chunk
            if current and readable_visible_len(candidate) > max_visible_chars:
                atoms.append(current)
                current = chunk
            else:
                current = candidate
        if current:
            atoms.append(current)

    balanced = []
    for atom in atoms:
        if (
            balanced
            and readable_visible_len(atom) <= READABLE_MIN_VISIBLE_CHARS
            and readable_visible_len(f"{balanced[-1]}{atom}") <= max_visible_chars
        ):
            balanced[-1] = f"{balanced[-1]}{atom}"
        else:
            balanced.append(atom)
    if (
        len(balanced) > 1
        and readable_visible_len(balanced[0]) <= READABLE_MIN_VISIBLE_CHARS
        and readable_visible_len(f"{balanced[0]}{balanced[1]}") <= max_visible_chars
    ):
        balanced[1] = f"{balanced[0]}{balanced[1]}"
        balanced = balanced[1:]
    return [atom for atom in balanced if visible_text(atom)]


def build_reference_readable_atoms(asr_entries, reference, piece_spans, split_config=None):
    split_config = resolve_split_config(split_config)
    atom_limit = min(
        READABLE_ATOM_TARGET_VISIBLE_CHARS,
        reference_authority_display_limit(reference, split_config),
    )
    atoms = []
    cursor = 0
    for atom_text in split_reference_text_for_readable_atoms(reference, atom_limit):
        start_pos = reference.find(atom_text, cursor)
        if start_pos < 0:
            return []
        end_pos = start_pos + len(atom_text)
        cursor = end_pos
        atom = {
            "index": len(atoms),
            "start_pos": start_pos,
            "end_pos": end_pos,
            "text": atom_text.strip(),
        }
        if update_reference_atom_time(atom, asr_entries, piece_spans) is None:
            return []
        atoms.append(atom)

    for index, atom in enumerate(atoms):
        atom["index"] = index
    return atoms


def subtitle_reading_seconds_per_visible_char(text):
    if has_latin_text(text):
        return 0.055
    return 0.13


def minimum_display_duration_for_text(text):
    visible_len = readable_visible_len(text)
    if visible_len <= 0:
        return 0.0
    base = 0.95 if visible_len <= READABLE_TARGET_VISIBLE_CHARS else 1.15
    return min(4.8, max(base, visible_len * subtitle_reading_seconds_per_visible_char(text)))


def has_unreadable_subtitle_duration(entry):
    text = get_subtitle_primary_text(entry)
    duration = subtitle_duration(entry)
    return duration > 0 and duration + 0.03 < minimum_display_duration_for_text(text)


def has_severe_unreadable_subtitle_duration(entry):
    text = get_subtitle_primary_text(entry)
    duration = subtitle_duration(entry)
    minimum = minimum_display_duration_for_text(text)
    if duration <= 0 or minimum <= 0:
        return False
    return duration + 0.03 < max(0.75, minimum * 0.45)


def has_intolerable_reference_authority_duration(entry):
    text = get_subtitle_primary_text(entry)
    duration = subtitle_duration(entry)
    minimum = minimum_display_duration_for_text(text)
    if duration <= 0 or minimum <= 0:
        return False
    return duration + 0.03 < max(0.75, minimum * 0.9)


def has_overextended_subtitle_duration(entry):
    text = get_subtitle_primary_text(entry)
    visible_len = readable_visible_len(text)
    if visible_len <= 0:
        return False
    duration = subtitle_duration(entry)
    if duration <= 0:
        return False
    minimum = minimum_display_duration_for_text(text)
    if visible_len <= READABLE_TARGET_VISIBLE_CHARS:
        return duration > max(4.8, minimum * 3.0)
    return duration > max(6.5, minimum * 2.4)


def subtitle_timing_quality_issues(entries, include_overextended=False):
    normalized = normalize_final_subtitles(entries)
    issues = []
    for index, entry in enumerate(normalized):
        if has_unreadable_subtitle_duration(entry):
            issues.append((index, "unreadable_duration", get_subtitle_primary_text(entry)))
        elif include_overextended and len(normalized) > 1 and has_overextended_subtitle_duration(entry):
            issues.append((index, "overextended_duration", get_subtitle_primary_text(entry)))

        if index > 0:
            previous_end = subtitle_time_range(normalized[index - 1])[1]
            current_start = subtitle_time_range(entry)[0]
            if current_start < previous_end - 0.03:
                issues.append((index, "overlap", get_subtitle_primary_text(entry)))
    return issues


def severe_subtitle_timing_quality_issues(entries):
    normalized = normalize_final_subtitles(entries)
    issues = []
    for index, entry in enumerate(normalized):
        if has_severe_unreadable_subtitle_duration(entry):
            issues.append((index, "severe_unreadable_duration", get_subtitle_primary_text(entry)))

        if index > 0:
            previous_end = subtitle_time_range(normalized[index - 1])[1]
            current_start = subtitle_time_range(entry)[0]
            if current_start < previous_end - 0.03:
                issues.append((index, "overlap", get_subtitle_primary_text(entry)))
    return issues


def parse_reference_atom_group_span(item):
    if not isinstance(item, dict):
        return None
    indices = item.get("atom_indices") or item.get("atoms")
    if isinstance(indices, list) and indices:
        parsed = [parse_reference_authority_index(value) for value in indices]
        if any(value is None for value in parsed):
            return None
        parsed = sorted(parsed)
        if parsed != list(range(parsed[0], parsed[-1] + 1)):
            return None
        return parsed[0], parsed[-1]

    start = None
    for key in ("start_atom_index", "start_atom", "from_atom_index", "from_atom"):
        if key in item:
            start = parse_reference_authority_index(item.get(key))
            break

    end = None
    for key in ("end_atom_index", "end_atom", "to_atom_index", "to_atom"):
        if key in item:
            end = parse_reference_authority_index(item.get(key))
            break

    if start is None and end is None:
        return None
    if start is None:
        start = end
    if end is None:
        end = start
    return start, end


def validate_reference_authority_llm_atom_groups(reference, atoms, results, split_config=None, return_reason=False):
    split_config = resolve_split_config(split_config)
    ordered_items = [item for item in results if isinstance(item, dict)] if isinstance(results, list) else []
    allowed_ranges = {
        (item["start_atom_index"], item["end_atom_index"])
        for item in build_allowed_reference_atom_ranges(reference, atoms, split_config)
    }
    def reject(reason):
        return ([], reason) if return_reason else []

    if not reference or not atoms or not ordered_items:
        return reject("missing_reference_atoms_or_results")
    if not any(parse_reference_atom_group_span(item) is not None for item in ordered_items):
        return reject("missing_atom_group_span")

    output = []
    next_atom_index = 0
    for item in ordered_items:
        span = parse_reference_atom_group_span(item)
        if span is None:
            return reject(f"invalid_atom_span_at_output_{len(output)}")
        start_atom_index, end_atom_index = span
        if not (0 <= start_atom_index <= end_atom_index < len(atoms)):
            return reject(f"atom_span_out_of_range:{start_atom_index}-{end_atom_index}")
        if start_atom_index != next_atom_index:
            return reject(f"atom_span_not_contiguous:expected_{next_atom_index}_got_{start_atom_index}")
        if allowed_ranges and (start_atom_index, end_atom_index) not in allowed_ranges:
            return reject(f"atom_span_not_allowed:{start_atom_index}-{end_atom_index}")
        next_atom_index = end_atom_index + 1

        start_atom = atoms[start_atom_index]
        end_atom = atoms[end_atom_index]
        text = apply_domain_corrections(reference[start_atom["start_pos"]:end_atom["end_pos"]].strip())
        if not visible_text(text):
            return reject(f"empty_text_for_atom_span:{start_atom_index}-{end_atom_index}")
        candidate_text = str(item.get("text") or item.get("zh") or "").strip()
        if candidate_text and visible_text(candidate_text) != visible_text(text):
            return reject(f"text_not_exact_reference_copy_for_atom_span:{start_atom_index}-{end_atom_index}")
        start_time = start_atom["time"][0]
        end_time = end_atom["time"][1]
        if end_time <= start_time:
            return reject(f"invalid_time_for_atom_span:{start_atom_index}-{end_atom_index}")
        duration = end_time - start_time
        max_duration = max(split_config["max_chunk_duration"] + 1.2, REFERENCE_AUTHORITY_GROUP_MAX_DURATION_SECONDS)
        if start_atom_index != end_atom_index and duration > max_duration:
            return reject(f"duration_too_long_for_atom_span:{start_atom_index}-{end_atom_index}")
        split_entries = split_validated_reference_authority_entry({
            "time": [start_time, end_time],
            "zh": text,
            "text": text,
        }, split_config, duration_check="intolerable")
        if not split_entries:
            return reject(f"duration_too_short_for_atom_span:{start_atom_index}-{end_atom_index}")
        if re.match(rf"^[{re.escape(READABLE_LEADING_PUNCTUATION)}]", text):
            return reject(f"leading_punctuation_for_atom_span:{start_atom_index}-{end_atom_index}")
        output.extend(split_entries)

    if next_atom_index != len(atoms):
        return reject(f"atom_coverage_incomplete:expected_{next_atom_index}_of_{len(atoms)}")
    joined = "".join(item["zh"] for item in output)
    if visible_text(joined) != visible_text(reference):
        return reject("joined_text_does_not_equal_reference")
    return (output, "") if return_reason else output


def validate_reference_authority_llm_text_groups(
    asr_entries,
    reference_text,
    results,
    split_config=None,
    require_position_hints=False,
):
    split_config = resolve_split_config(split_config)
    reference = apply_domain_corrections(str(reference_text or "").strip())
    normalized_asr_entries = merge_reference_authority_micro_asr_fragments(asr_entries)
    ordered_items = [item for item in results if isinstance(item, dict)] if isinstance(results, list) else []
    if not normalized_asr_entries or not reference or not ordered_items:
        return []

    reference_pieces = split_reference_text_by_asr_segments(reference, normalized_asr_entries)
    if len(reference_pieces) != len(normalized_asr_entries):
        return []
    piece_spans = build_reference_piece_spans(reference, reference_pieces)
    if len(piece_spans) != len(reference_pieces):
        return []

    cursor = 0
    previous_end_time = None
    output = []
    for item in ordered_items:
        raw_text = apply_domain_corrections(str(item.get("text") or item.get("zh") or "").strip())
        if not raw_text:
            return []

        position = reference.find(raw_text, cursor)
        if position < 0:
            return []
        skipped = reference[cursor:position]
        if visible_text(skipped) and not all(char.isspace() for char in skipped):
            return []

        start_position = position if skipped and not visible_text(skipped) else cursor
        end_position = position + len(raw_text)
        if require_position_hints and not reference_position_hint_matches(
            item,
            reference,
            position,
            end_position,
        ):
            return []

        span_time = time_range_for_reference_span(
            normalized_asr_entries,
            piece_spans,
            start_position,
            end_position,
        )
        if span_time is None:
            return []
        _actual_start_index, _actual_end_index, start_time, end_time = span_time
        if previous_end_time is not None and start_time < previous_end_time - 0.03:
            return []

        assigned_text = apply_domain_corrections(reference[start_position:end_position].strip())
        if not visible_text(assigned_text):
            return []
        entry = {
            "time": [start_time, end_time],
            "zh": assigned_text,
            "text": assigned_text,
        }
        if subtitle_duration(entry) > REFERENCE_AUTHORITY_GROUP_MAX_DURATION_SECONDS:
            return []
        if re.match(rf"^[{re.escape(READABLE_LEADING_PUNCTUATION)}]", assigned_text):
            return []
        split_entries = split_validated_reference_authority_entry(entry, split_config)
        if not split_entries:
            return []

        output.extend(split_entries)
        previous_end_time = end_time
        cursor = end_position

    if visible_text(reference[cursor:]):
        return []

    joined = "".join(item["zh"] for item in output)
    if visible_text(joined) != visible_text(reference):
        return []
    return output


def text_group_results_cover_reference(reference_text, results, *, require_position_hints=False):
    reference = apply_domain_corrections(str(reference_text or "").strip())
    ordered_items = [item for item in results if isinstance(item, dict)] if isinstance(results, list) else []
    if not reference or not ordered_items:
        return False

    cursor = 0
    for item in ordered_items:
        raw_text = apply_domain_corrections(str(item.get("text") or item.get("zh") or "").strip())
        if not raw_text:
            return False
        position = reference.find(raw_text, cursor)
        if position < 0:
            return False
        skipped = reference[cursor:position]
        if visible_text(skipped):
            return False
        end_position = position + len(raw_text)
        if require_position_hints and not reference_position_hint_matches(
            item,
            reference,
            position,
            end_position,
        ):
            return False
        cursor = end_position
    return not visible_text(reference[cursor:])


def rebalance_reference_authority_split_durations(entries):
    normalized = normalize_final_subtitles(entries)
    if len(normalized) <= 1:
        return normalized

    first_time = subtitle_time_range(normalized[0])
    last_time = subtitle_time_range(normalized[-1])
    if not first_time or not last_time:
        return normalized

    start = first_time[0]
    end = last_time[1]
    total_duration = end - start
    if total_duration <= 0:
        return normalized

    minimums = [
        max(0.75, minimum_display_duration_for_text(get_subtitle_primary_text(item)) * 0.45)
        for item in normalized
    ]
    required_total = sum(minimums)
    if required_total > total_duration + 0.03:
        return normalized

    weights = [max(1, readable_visible_len(get_subtitle_primary_text(item))) for item in normalized]
    extra_duration = max(0.0, total_duration - required_total)
    total_weight = max(1, sum(weights))

    output = []
    cursor = start
    for index, item in enumerate(normalized):
        if index == len(normalized) - 1:
            item_end = end
        else:
            item_duration = minimums[index] + (extra_duration * weights[index] / total_weight)
            item_end = min(end, cursor + item_duration)
        output.append({**item, "time": [round(cursor, 2), round(item_end, 2)]})
        cursor = item_end
    return normalize_final_subtitles(output)


def split_validated_reference_authority_entry(entry, split_config=None, *, duration_check="severe"):
    text = get_subtitle_primary_text(entry)
    if not visible_text(text):
        return []

    entries = [entry]
    if not reference_authority_text_fits_display(text, split_config):
        entries = split_reference_authority_entries_for_display([entry], split_config)
        entries = rebalance_reference_authority_split_durations(entries)
        joined = "".join(get_subtitle_primary_text(item) for item in entries)
        if visible_text(joined) != visible_text(text):
            return []

    for item in entries:
        item_text = get_subtitle_primary_text(item)
        if not reference_authority_text_fits_display(item_text, split_config):
            return []
        if re.match(rf"^[{re.escape(READABLE_LEADING_PUNCTUATION)}]", item_text):
            return []
        if duration_check == "intolerable":
            if has_intolerable_reference_authority_duration(item):
                return []
        elif has_severe_unreadable_subtitle_duration(item):
            return []
    return entries


def choose_allowed_reference_atom_partition(reference, atoms, split_config=None):
    allowed_ranges = build_allowed_reference_atom_ranges(reference, atoms, split_config)
    if not atoms or not allowed_ranges:
        return []

    grouped_by_start = {}
    for item in allowed_ranges:
        start_index = item["start_atom_index"]
        end_index = item["end_atom_index"]
        text = apply_domain_corrections(
            reference[atoms[start_index]["start_pos"]:atoms[end_index]["end_pos"]].strip()
        )
        duration = atoms[end_index]["time"][1] - atoms[start_index]["time"][0]
        score = (
            abs(readable_visible_len(text) - READABLE_TARGET_VISIBLE_CHARS),
            0 if ends_with_sentence_punctuation(text) else 1,
            -duration,
            -(end_index - start_index),
        )
        grouped_by_start.setdefault(start_index, []).append((score, start_index, end_index))

    memo = {}

    def visit(start_index):
        if start_index == len(atoms):
            return []
        if start_index in memo:
            return memo[start_index]
        candidates = sorted(grouped_by_start.get(start_index, []), key=lambda item: item[0])
        for _score, candidate_start, candidate_end in candidates:
            tail = visit(candidate_end + 1)
            if tail is not None:
                memo[start_index] = [(candidate_start, candidate_end)] + tail
                return memo[start_index]
        memo[start_index] = None
        return None

    return visit(0) or []


def build_reference_authority_entries_from_atom_partition(reference, atoms, partition, split_config=None):
    output = []
    for start_atom_index, end_atom_index in partition or []:
        if not (0 <= start_atom_index <= end_atom_index < len(atoms)):
            return []
        start_atom = atoms[start_atom_index]
        end_atom = atoms[end_atom_index]
        text = apply_domain_corrections(reference[start_atom["start_pos"]:end_atom["end_pos"]].strip())
        if not visible_text(text):
            return []
        entry = {
            "time": [start_atom["time"][0], end_atom["time"][1]],
            "zh": text,
            "text": text,
        }
        if not reference_authority_text_fits_display(text, split_config):
            return []
        if has_intolerable_reference_authority_duration(entry):
            return []
        if re.match(rf"^[{re.escape(READABLE_LEADING_PUNCTUATION)}]", text):
            return []
        output.append(entry)

    joined = "".join(item["zh"] for item in output)
    if visible_text(joined) != visible_text(reference):
        return []
    return output


def build_reference_authority_deterministic_atom_groups(asr_entries, reference_text, split_config=None):
    reference = apply_domain_corrections(str(reference_text or "").strip())
    normalized_asr_entries = merge_reference_authority_micro_asr_fragments(asr_entries)
    reference_pieces = split_reference_text_by_asr_segments(reference, normalized_asr_entries)
    piece_spans = build_reference_piece_spans(reference, reference_pieces)
    if len(piece_spans) != len(reference_pieces):
        return []
    atoms = build_reference_readable_atoms(normalized_asr_entries, reference, piece_spans, split_config)
    partition = choose_allowed_reference_atom_partition(reference, atoms, split_config)
    return build_reference_authority_entries_from_atom_partition(reference, atoms, partition, split_config)


def build_reference_authority_split_fallback_entries(asr_entries, reference_text, reference_entry=None, split_config=None):
    split_config = resolve_split_config(split_config)
    reference = apply_domain_corrections(str(reference_text or "").strip())
    normalized_asr_entries = merge_reference_authority_micro_asr_fragments(asr_entries)
    if not normalized_asr_entries or not reference:
        return []
    reference_chunks = split_reference_text_for_authority(
        reference,
        {**split_config, "max_visible_chars": reference_authority_display_limit(reference, split_config)}
    )
    if not reference_chunks:
        return []
    entries = build_reference_authority_entries(
        normalized_asr_entries,
        reference_chunks,
        reference_entry=reference_entry,
        split_config=split_config,
    )
    return split_reference_authority_entries_for_display(entries, split_config)


def build_reference_authority_reference_timing_entries(reference_entry, split_config=None, previous_end=None):
    split_config = resolve_split_config(split_config)
    ref_time = subtitle_time_range(reference_entry)
    reference_text = get_subtitle_primary_text(reference_entry)
    if not ref_time or not reference_text:
        return []
    reference_chunks = split_reference_text_for_authority(
        reference_text,
        {**split_config, "max_visible_chars": reference_authority_display_limit(reference_text, split_config)}
    )
    if not reference_chunks:
        return []

    start, end = ref_time
    min_start = max(start, float(previous_end)) if previous_end is not None else start
    if end <= min_start:
        return []
    synthetic_entry = {
        "time": [round(min_start, 2), end],
        "zh": reference_text,
        "text": reference_text,
    }
    entries = build_reference_authority_entries([synthetic_entry], reference_chunks, split_config=split_config)
    return split_reference_authority_entries_for_display(entries, split_config)


def reference_authority_fallback_is_usable(entries, reference_text, *, allow_severe_timing=False):
    normalized = normalize_final_subtitles(entries)
    reference = apply_domain_corrections(str(reference_text or "").strip())
    if not normalized or not reference:
        return False
    joined = "".join(get_subtitle_primary_text(item) for item in normalized)
    if visible_text(joined) != visible_text(reference):
        return False
    if any(not reference_authority_text_fits_display(get_subtitle_primary_text(item)) for item in normalized):
        return False
    if not allow_severe_timing and severe_subtitle_timing_quality_issues(normalized):
        return False
    return True


def finalize_reference_authority_fallback_entries(
    entries,
    source_entries,
    reference_entry,
    split_config,
    *,
    use_polish,
    previous_end=None,
    close_continuous_gaps=True,
    allow_severe_timing=False,
):
    finalized = finalize_reference_authority_block(
        entries,
        source_entries,
        reference_entry,
        split_config,
        use_polish=use_polish,
        previous_end=previous_end,
        close_continuous_gaps=close_continuous_gaps,
    )
    reference_text = get_subtitle_primary_text(reference_entry)
    if reference_authority_fallback_is_usable(
        finalized,
        reference_text,
        allow_severe_timing=allow_severe_timing,
    ):
        return finalized
    return []


def build_reference_authority_failsoft_block(
    selected_entries,
    reference_entry,
    split_config=None,
    previous_end=None,
    reason="",
):
    reference_text = get_subtitle_primary_text(reference_entry)
    normalized_asr_entries = merge_reference_authority_micro_asr_fragments(selected_entries)
    attempts = [
        (
            "deterministic_atom_projection",
            build_reference_authority_deterministic_atom_groups(
                normalized_asr_entries,
                reference_text,
                split_config,
            ),
            False,
            normalized_asr_entries,
        ),
        (
            "deterministic_reference_authority_split",
            build_reference_authority_split_fallback_entries(
                normalized_asr_entries,
                reference_text,
                reference_entry=reference_entry,
                split_config=split_config,
            ),
            True,
            normalized_asr_entries,
        ),
        (
            "reference_subtitle_timing",
            build_reference_authority_reference_timing_entries(
                reference_entry,
                split_config,
                previous_end=previous_end,
            ),
            True,
            [reference_entry],
        ),
    ]

    for fallback_stage, entries, use_polish, source_entries in attempts:
        block_entries = finalize_reference_authority_fallback_entries(
            entries,
            source_entries,
            reference_entry,
            split_config,
            use_polish=use_polish,
            previous_end=previous_end,
            close_continuous_gaps=True,
            allow_severe_timing=fallback_stage == "reference_subtitle_timing",
        )
        if block_entries:
            print(f"   ⚠️ 参考文本权威严格分配失败，使用{fallback_stage}兜底: {reason}")
            append_reference_authority_fallback_debug_event(
                fallback_stage,
                reason,
                reference_text=reference_text,
                asr_entries=normalized_asr_entries,
                fallback_entries=block_entries,
            )
            return block_entries

    append_reference_authority_fallback_debug_event(
        "unavailable",
        reason,
        reference_text=reference_text,
        asr_entries=normalized_asr_entries,
        fallback_entries=[],
    )
    return []


def validate_reference_authority_llm_groups(asr_entries, reference_text, results, split_config=None):
    split_config = resolve_split_config(split_config)
    reference = apply_domain_corrections(str(reference_text or "").strip())
    normalized_asr_entries = merge_reference_authority_micro_asr_fragments(asr_entries)
    ordered_items = [item for item in results if isinstance(item, dict)] if isinstance(results, list) else []
    if not normalized_asr_entries or not reference or not ordered_items:
        return []
    has_group_span = any(parse_reference_authority_group_span(item) is not None for item in ordered_items)
    has_atom_group_span = any(parse_reference_atom_group_span(item) is not None for item in ordered_items)
    if not has_group_span and not has_atom_group_span:
        return []

    reference_pieces = split_reference_text_by_asr_segments(reference, normalized_asr_entries)
    piece_spans = build_reference_piece_spans(reference, reference_pieces)
    if has_atom_group_span and len(piece_spans) == len(reference_pieces):
        atoms = build_reference_readable_atoms(normalized_asr_entries, reference, piece_spans, split_config)
        atom_grouped = validate_reference_authority_llm_atom_groups(reference, atoms, results, split_config)
        if atom_grouped:
            return atom_grouped

    if len(reference_pieces) != len(normalized_asr_entries):
        return []
    if len(piece_spans) != len(reference_pieces):
        return []

    cursor = 0
    previous_actual_end_index = -1
    previous_end_time = None
    output = []
    for item in ordered_items:
        span = parse_reference_authority_group_span(item)
        if span is None:
            return []
        start_index, end_index = span
        if start_index is None or end_index is None:
            return []
        if not (0 <= start_index <= end_index < len(normalized_asr_entries)):
            return []

        raw_text = str(item.get("text") or item.get("zh") or "").strip()
        if not raw_text:
            continue

        position = reference.find(raw_text, cursor)
        if position != cursor:
            return []
        end_position = position + len(raw_text)

        span_time = time_range_for_reference_span(normalized_asr_entries, piece_spans, position, end_position)
        if span_time is None:
            return []
        actual_start_index, actual_end_index, start_time, end_time = span_time
        if actual_start_index < previous_actual_end_index:
            return []
        if previous_end_time is not None and start_time < previous_end_time - 0.03:
            return []
        previous_actual_end_index = actual_end_index

        assigned_text = apply_domain_corrections(raw_text)
        cursor = end_position
        if not assigned_text:
            continue

        entry = {
            "time": [start_time, end_time],
            "zh": assigned_text,
            "text": assigned_text,
        }
        if (
            start_index != end_index
            and subtitle_duration(entry) > REFERENCE_AUTHORITY_GROUP_MAX_DURATION_SECONDS
        ):
            return []
        if has_severe_unreadable_subtitle_duration(entry):
            return []
        if re.match(rf"^[{re.escape(READABLE_LEADING_PUNCTUATION)}]", assigned_text):
            return []
        split_entries = split_validated_reference_authority_entry(entry, split_config)
        if not split_entries:
            return []
        output.extend(split_entries)
        previous_end_time = end_time

    if reference[cursor:].strip():
        return []

    if not output:
        return []

    joined = "".join(item["zh"] for item in output)
    if visible_text(joined) != visible_text(reference):
        return []
    return output


def validate_reference_authority_llm_results(
    asr_entries,
    reference_text,
    results,
    split_config=None,
    require_atom_groups=False,
    allow_deterministic_repair=True,
):
    normalized_asr_entries = merge_reference_authority_micro_asr_fragments(asr_entries)
    ordered_items = [item for item in results if isinstance(item, dict)] if isinstance(results, list) else []
    if require_atom_groups and not any(parse_reference_atom_group_span(item) is not None for item in ordered_items):
        text_grouped = validate_reference_authority_llm_text_groups(
            normalized_asr_entries,
            reference_text,
            results,
            split_config,
            require_position_hints=True,
        )
        if text_grouped:
            return text_grouped
        reference = apply_domain_corrections(str(reference_text or "").strip())
        if allow_deterministic_repair and text_group_results_cover_reference(reference, results, require_position_hints=True):
            deterministic = build_reference_authority_deterministic_atom_groups(
                normalized_asr_entries,
                reference,
                split_config,
            )
            if deterministic:
                return deterministic
        return []

    reference = apply_domain_corrections(str(reference_text or "").strip())
    text_grouped = validate_reference_authority_llm_text_groups(
        normalized_asr_entries,
        reference_text,
        results,
        split_config,
        require_position_hints=False,
    )
    if text_grouped:
        return text_grouped

    grouped = validate_reference_authority_llm_groups(normalized_asr_entries, reference_text, results, split_config)
    if grouped:
        return grouped
    if require_atom_groups and allow_deterministic_repair:
        deterministic = build_reference_authority_deterministic_atom_groups(
            normalized_asr_entries,
            reference,
            split_config,
        )
        if deterministic:
            return deterministic

    if any(parse_reference_authority_group_span(item) is not None for item in ordered_items):
        if allow_deterministic_repair and text_group_results_cover_reference(
            reference,
            results,
            require_position_hints=True,
        ):
            deterministic = build_reference_authority_deterministic_atom_groups(
                normalized_asr_entries,
                reference,
                split_config,
            )
            if deterministic:
                return deterministic
        return []

    if not allow_deterministic_repair:
        return []

    if not normalized_asr_entries or not reference or not isinstance(results, list):
        return []

    by_index = {}
    for fallback_index, item in enumerate(ordered_items):
        try:
            index = int(item.get("index", fallback_index))
        except (TypeError, ValueError):
            continue
        by_index[index] = item

    cursor = 0
    assignments = []
    for index, asr_entry in enumerate(normalized_asr_entries):
        item = by_index.get(index)
        if item is None:
            assignments.append((asr_entry, ""))
            continue

        raw_text = str(item.get("text") or item.get("zh") or "").strip()
        if not raw_text:
            assignments.append((asr_entry, ""))
            continue

        position = reference.find(raw_text, cursor)
        if position < 0:
            return []

        assigned_text = reference[cursor:position] + reference[position:position + len(raw_text)]
        cursor = position + len(raw_text)
        assignments.append((asr_entry, apply_domain_corrections(assigned_text.strip())))

    tail = reference[cursor:].strip()
    if tail:
        for index in range(len(assignments) - 1, -1, -1):
            if assignments[index][1]:
                entry, text = assignments[index]
                assignments[index] = (entry, apply_domain_corrections(f"{text}{tail}"))
                break
        else:
            assignments.append((normalized_asr_entries[-1], apply_domain_corrections(tail)))

    output = []
    for asr_entry, text in assignments:
        if not text:
            continue
        time_range = subtitle_time_range(asr_entry)
        if not time_range:
            continue
        entry = {
            "time": [time_range[0], time_range[1]],
            "zh": text,
            "text": text,
        }
        split_entries = split_validated_reference_authority_entry(entry, split_config)
        if not split_entries:
            return []
        output.extend(split_entries)

    if not output:
        return []

    joined = "".join(item["zh"] for item in output)
    if visible_text(joined) != visible_text(reference):
        return []

    natural_piece_count = max(1, len(split_text_by_clause_boundaries(reference)))
    min_expected = min(len(normalized_asr_entries), natural_piece_count, 2)
    if len(normalized_asr_entries) > 1 and len(output) < min_expected:
        return []
    return output


def diagnose_reference_authority_llm_results(asr_entries, reference_text, results, split_config=None, require_atom_groups=False):
    reference = apply_domain_corrections(str(reference_text or "").strip())
    normalized_asr_entries = merge_reference_authority_micro_asr_fragments(asr_entries)
    ordered_items = [item for item in results if isinstance(item, dict)] if isinstance(results, list) else []
    if not isinstance(results, list):
        return "llm_output_is_not_json_array"
    if not ordered_items:
        return "llm_output_has_no_objects"
    reference_pieces = split_reference_text_by_asr_segments(reference, normalized_asr_entries)
    piece_spans = build_reference_piece_spans(reference, reference_pieces)
    atoms = build_reference_readable_atoms(normalized_asr_entries, reference, piece_spans, split_config) if piece_spans else []
    if require_atom_groups:
        if not atoms:
            return "reference_atoms_unavailable"
        if not any(parse_reference_atom_group_span(item) is not None for item in ordered_items):
            return "missing_atom_group_span"
        _atom_entries, atom_reason = validate_reference_authority_llm_atom_groups(
            reference,
            atoms,
            results,
            split_config,
            return_reason=True,
        )
        return atom_reason or "unknown_atom_group_validation_failure"
    text_grouped = validate_reference_authority_llm_text_groups(
        normalized_asr_entries,
        reference,
        results,
        split_config,
        require_position_hints=False,
    )
    if text_grouped:
        return ""
    if any(parse_reference_authority_group_span(item) is not None for item in ordered_items):
        grouped = validate_reference_authority_llm_groups(normalized_asr_entries, reference, results, split_config)
        return "" if grouped else "asr_group_validation_failed"
    return "index_assignment_validation_failed"


def subtitle_boundary_candidates(entries, reference_entry=None):
    candidates = set()
    for entry in entries or []:
        time_range = subtitle_time_range(entry)
        if time_range:
            candidates.add(round(time_range[0], 2))
            candidates.add(round(time_range[1], 2))
    ref_time = subtitle_time_range(reference_entry) if reference_entry else None
    if ref_time:
        candidates.add(round(ref_time[0], 2))
        candidates.add(round(ref_time[1], 2))
    return sorted(candidates)


def nearest_boundary_index(candidates, value):
    if not candidates:
        return -1
    target = float(value)
    return min(range(len(candidates)), key=lambda index: abs(candidates[index] - target))


def normalized_subtitle_reading_load(entry):
    text = get_subtitle_primary_text(entry)
    minimum = minimum_display_duration_for_text(text)
    duration = subtitle_duration(entry)
    if minimum <= 0 or duration <= 0:
        return 1.0
    return minimum / duration


def balance_reference_authority_group_timing(entries, source_entries, reference_entry=None):
    normalized = normalize_final_subtitles(entries)
    if len(normalized) <= 1:
        return normalized

    candidates = subtitle_boundary_candidates(source_entries, reference_entry)
    if len(candidates) < 2:
        return normalized

    changed = False
    output = [dict(entry) for entry in normalized]
    for index, entry in enumerate(output):
        time_range = subtitle_time_range(entry)
        if not time_range:
            continue
        start, end = time_range
        if end - start >= minimum_display_duration_for_text(get_subtitle_primary_text(entry)):
            continue

        start_boundary_index = nearest_boundary_index(candidates, start)
        end_boundary_index = nearest_boundary_index(candidates, end)
        if start_boundary_index < 0 or end_boundary_index <= start_boundary_index:
            continue

        required_duration = minimum_display_duration_for_text(get_subtitle_primary_text(entry))
        adjusted_current = False

        if index > 0 and start_boundary_index > 0:
            previous = output[index - 1]
            previous_start, previous_end = subtitle_time_range(previous)
            previous_required = minimum_display_duration_for_text(get_subtitle_primary_text(previous))
            best_partial_start = None
            for candidate_index in range(start_boundary_index - 1, -1, -1):
                candidate_start = candidates[candidate_index]
                if candidate_start <= previous_start:
                    break
                if candidate_start > previous_end + 0.03:
                    continue
                if best_partial_start is None:
                    best_partial_start = candidate_start
                if end - candidate_start + 0.03 < required_duration:
                    continue
                if candidate_start - previous_start + 0.03 < previous_required:
                    continue
                previous["time"] = [previous_start, round(candidate_start, 2)]
                entry["time"] = [round(candidate_start, 2), end]
                adjusted_current = True
                changed = True
                break
            if (
                not adjusted_current
                and best_partial_start is not None
                and end - best_partial_start > end - start + 0.25
            ):
                previous["time"] = [previous_start, round(best_partial_start, 2)]
                entry["time"] = [round(best_partial_start, 2), end]
                adjusted_current = True
                changed = True

        start, end = subtitle_time_range(entry)
        if end - start + 0.03 >= required_duration:
            continue

        if index + 1 < len(output) and end_boundary_index + 1 < len(candidates):
            next_entry = output[index + 1]
            next_start, next_end = subtitle_time_range(next_entry)
            next_required = minimum_display_duration_for_text(get_subtitle_primary_text(next_entry))
            for candidate_index in range(end_boundary_index + 1, len(candidates)):
                candidate_end = candidates[candidate_index]
                if candidate_end >= next_end:
                    break
                if candidate_end < next_start - 0.03:
                    continue
                if candidate_end - start + 0.03 < required_duration:
                    continue
                if next_end - candidate_end + 0.03 < next_required:
                    continue
                entry["time"] = [start, round(candidate_end, 2)]
                next_entry["time"] = [round(candidate_end, 2), next_end]
                changed = True
                break

    balanced = normalize_final_subtitles(output)
    if changed:
        print("   ✅ 已按阅读时长与 ASR 边界平衡字幕时间轴")
    return balanced


def close_short_reference_authority_gaps(entries, max_gap=REFERENCE_AUTHORITY_MAX_INTERNAL_GAP_SECONDS):
    normalized = normalize_final_subtitles(entries)
    if len(normalized) <= 1:
        return normalized

    output = [dict(entry) for entry in normalized]
    changed = False
    for index in range(len(output) - 1):
        current_time = subtitle_time_range(output[index])
        next_time = subtitle_time_range(output[index + 1])
        if not current_time or not next_time:
            continue
        current_start, current_end = current_time
        next_start, next_end = next_time
        gap = next_start - current_end
        if gap <= 0.03 or gap > max_gap:
            continue

        current_load = normalized_subtitle_reading_load(output[index])
        next_load = normalized_subtitle_reading_load(output[index + 1])
        if current_load >= next_load:
            output[index]["time"] = [current_start, round(next_start, 2)]
        else:
            output[index + 1]["time"] = [round(current_end, 2), next_end]
        changed = True

    if changed:
        print("   ✅ 已闭合参考字幕段内短空隙")
    return normalize_final_subtitles(output)


def close_continuous_reference_authority_gaps(
    entries,
    reference_entry=None,
    previous_end=None,
    max_gap=REFERENCE_AUTHORITY_MAX_CONTINUOUS_GAP_SECONDS,
):
    normalized = normalize_final_subtitles(entries)
    if not normalized:
        return normalized

    ref_time = subtitle_time_range(reference_entry) if reference_entry else None
    if not ref_time and len(normalized) <= 1:
        return normalized

    output = [dict(entry) for entry in normalized]
    changed = False

    if ref_time:
        ref_start, ref_end = ref_time
        first_start, first_end = subtitle_time_range(output[0])
        min_start = ref_start
        if previous_end is not None:
            min_start = max(min_start, float(previous_end))
        if previous_end is not None and first_start - min_start > 0.03 and first_end > min_start:
            leading_gap = first_start - min_start
            if leading_gap <= max_gap:
                output[0]["time"] = [round(min_start, 2), first_end]
                changed = True

        last_start, last_end = subtitle_time_range(output[-1])
        trailing_gap = ref_end - last_end
        if trailing_gap > 0.03 and trailing_gap <= max_gap and ref_end > last_start:
            output[-1]["time"] = [last_start, round(ref_end, 2)]
            changed = True

    for index in range(len(output) - 1):
        current_time = subtitle_time_range(output[index])
        next_time = subtitle_time_range(output[index + 1])
        if not current_time or not next_time:
            continue
        current_start, current_end = current_time
        next_start, next_end = next_time
        gap = next_start - current_end
        if gap <= 0.03 or gap > max_gap:
            continue

        current_load = normalized_subtitle_reading_load(output[index])
        next_load = normalized_subtitle_reading_load(output[index + 1])
        if current_load >= next_load:
            output[index]["time"] = [current_start, round(next_start, 2)]
        else:
            output[index + 1]["time"] = [round(current_end, 2), next_end]
        changed = True

    if changed:
        print("   ✅ 已闭合参考字幕连续口播空隙")
    return normalize_final_subtitles(output)


def extend_reference_authority_block_tail(
    entries,
    reference_entry=None,
    max_extension=REFERENCE_AUTHORITY_MAX_TAIL_EXTENSION_SECONDS,
):
    normalized = normalize_final_subtitles(entries)
    ref_time = subtitle_time_range(reference_entry) if reference_entry else None
    if not normalized or not ref_time:
        return normalized

    _ref_start, ref_end = ref_time
    output = [dict(entry) for entry in normalized]
    last_start, last_end = subtitle_time_range(output[-1])
    trailing_gap = ref_end - last_end
    if trailing_gap <= 0.03 or trailing_gap > max_extension or ref_end <= last_start:
        return normalized

    output[-1]["time"] = [last_start, round(ref_end, 2)]
    print("   ✅ 已延长参考字幕尾段到口播结束")
    return normalize_final_subtitles(output)


def enforce_reference_authority_display_limits(entries, split_config=None):
    return normalize_final_subtitles(entries)


def split_reference_authority_reference_entries_for_display(entries, split_config=None):
    return normalize_final_subtitles(entries)


def finalize_reference_authority_block(
    entries,
    source_entries,
    reference_entry=None,
    split_config=None,
    use_polish=True,
    previous_end=None,
    close_continuous_gaps=False,
):
    block_entries = normalize_final_subtitles(entries)
    if use_polish:
        block_entries = polish_readable_subtitle_segments(block_entries, split_config, use_llm=False)
    block_entries = balance_reference_authority_group_timing(block_entries, source_entries, reference_entry)
    block_entries = close_short_reference_authority_gaps(block_entries)
    if close_continuous_gaps:
        block_entries = close_continuous_reference_authority_gaps(
            block_entries,
            reference_entry,
            previous_end=previous_end,
        )
        block_entries = extend_reference_authority_block_tail(block_entries, reference_entry)
    return block_entries


def reference_authority_retry_count():
    try:
        return max(5, int(os.getenv("REFERENCE_AUTHORITY_LLM_RETRIES", "5")))
    except (TypeError, ValueError):
        return 5


def reference_authority_has_readable_atoms(asr_entries, reference, split_config=None):
    normalized_asr_entries = merge_reference_authority_micro_asr_fragments(asr_entries)
    reference_pieces = split_reference_text_by_asr_segments(reference, normalized_asr_entries)
    piece_spans = build_reference_piece_spans(reference, reference_pieces)
    if not piece_spans:
        return False
    return bool(build_reference_readable_atoms(normalized_asr_entries, reference, piece_spans, split_config))


def build_allowed_reference_atom_ranges(reference, atoms, split_config=None):
    split_config = resolve_split_config(split_config)
    ranges = []
    max_duration = max(split_config["max_chunk_duration"] + 1.2, REFERENCE_AUTHORITY_GROUP_MAX_DURATION_SECONDS)
    for start_index, start_atom in enumerate(atoms or []):
        for end_index in range(start_index, len(atoms)):
            end_atom = atoms[end_index]
            text = apply_domain_corrections(reference[start_atom["start_pos"]:end_atom["end_pos"]].strip())
            if not visible_text(text):
                continue
            if re.match(rf"^[{re.escape(READABLE_LEADING_PUNCTUATION)}]", text):
                continue
            if not reference_authority_text_fits_display(text, split_config):
                break
            start_time = start_atom["time"][0]
            end_time = end_atom["time"][1]
            if end_time <= start_time:
                continue
            duration = end_time - start_time
            if duration > max_duration:
                break
            if has_intolerable_reference_authority_duration({
                "time": [start_time, end_time],
                "zh": text,
                "text": text,
            }):
                continue
            ranges.append({
                "start_atom_index": start_index,
                "end_atom_index": end_index,
            })
    return ranges


def build_reference_authority_prompt(asr_entries, reference_text, source_language="", split_config=None, retry_index=0, failure_reason=""):
    split_config = resolve_split_config(split_config)
    reference = str(reference_text or "").strip()
    display_limit = reference_authority_display_limit(reference, split_config)
    target_min = max(8, min(14, display_limit - 10))
    target_max = max(target_min, min(22, display_limit - 2))
    normalized_asr_entries = merge_reference_authority_micro_asr_fragments(asr_entries)
    payload = {
        "source_language": source_language or "auto",
        "reference_text": reference,
        "asr_segments": [
            {
                "index": index,
                "time": list(subtitle_time_range(entry) or []),
                "asr_text": get_subtitle_primary_text(entry),
            }
            for index, entry in enumerate(normalized_asr_entries)
        ],
    }
    retry_instruction = ""
    if retry_index > 0:
        retry_instruction = (
            f"这是第 {retry_index + 1} 次尝试。上一轮失败原因：{failure_reason or '输出不是可解析的字幕 JSON'}。"
            "这次必须直接输出可解析的最终字幕 JSON 数组。"
        )

    return (
        "你是字幕时间轴与阅读分组助手。任务是直接输出最终可渲染字幕 JSON。"
        "最高优先级：reference_text 是唯一文本来源和最终口播稿，ASR 只用于判断时间边界、停顿和语义位置。"
        "最终输出的 zh 必须只由 reference_text 中按顺序出现的连续原文子串组成。"
        "严禁翻译、润色、同义替换、概括、补词、删词、改标点含义，严禁把 ASR 文本写进 zh。"
        "如果 ASR 与 reference_text 冲突，必须无条件相信 reference_text；数字、金额、单位、专有名词必须完整照抄。"
        "例如 reference_text 写 750,000到1,250,000美元，就必须完整保留这一段，不能改成 750000~，也不能漏掉 1,250,000美元。"
        "例如 reference_text 写 顶部的想象，就必须输出 顶部的想象，不能改成 顶部的预期。"
        "不要按时长比例机械分配；要参考每条 asr_text 的语义、停顿和相邻句段给每条 zh 填入 time。"
        f"竖屏画面只有两行中文字幕区域，这是硬约束：每个显示字幕组最多 {display_limit} 个可见中文字符，"
        f"推荐 {target_min}-{target_max} 个可见字符。宁可多输出几条短字幕，也绝不能输出超长字幕。"
        "如果一个句子超过上限，你必须沿 ASR 时间边界或自然分句拆成多条。"
        "不要把多个完整句子、多个逗号分句、或一整段口播合并成一条字幕。"
        "每个显示字幕组避免以标点开头，避免把固定短语拆开。"
        "必须保护数字、金额、百分比、ticker 和专有名词，禁止把 7.5%、2%-3%、$BMNR、1000万 这类 token 从中间拆开。"
        "直接输出最终字幕 JSON 数组；每项必须包含 time 和 zh，可选 en。"
        "time 必须是 [start,end] 秒，start/end 参考 asr_segments 的时间轴，整体顺序递增且覆盖口播。"
        "zh 必须逐字复制 reference_text 的连续原文片段；所有 zh 拼接后必须完整等于 reference_text。"
        "只输出 JSON，不要 markdown。\n\n"
        f"{retry_instruction}\n"
        f"输入：{json.dumps(payload, ensure_ascii=False)}"
    )


def parse_direct_reference_authority_subtitles(results, reference_text):
    if not str(reference_text or "").strip() or not isinstance(results, list):
        return []

    output = []
    for item in results:
        if not isinstance(item, dict):
            return []
        time_range = subtitle_time_range(item)
        if not time_range:
            return []
        text = str(item.get("zh") or item.get("text") or "").strip()
        if not text:
            return []
        entry = {
            "time": [time_range[0], time_range[1]],
            "zh": text,
            "text": text,
        }
        if str(item.get("en") or "").strip():
            entry["en"] = str(item.get("en") or "").strip()
        output.append(entry)

    return normalize_final_subtitles(output)


def align_reference_authority_with_llm(asr_entries, reference_text, source_language="", split_config=None, strict=False):
    split_config = resolve_split_config(split_config)
    reference = str(reference_text or "").strip()
    normalized_asr_entries = merge_reference_authority_micro_asr_fragments(asr_entries)
    if len(normalized_asr_entries or []) <= 1 or not reference:
        return []

    max_attempts = reference_authority_retry_count() if strict else 1
    provider = None
    client = None
    model = None
    last_error = ""
    for attempt in range(max_attempts):
        attempt_error = ""
        try:
            emit_stage(
                "subtitle_reference_authority",
                f"正在让大模型直接输出参考口播稿字幕（第 {attempt + 1}/{max_attempts} 次）"
            )
            if client is None:
                provider = get_text_llm_provider()
                client = create_llm_client(provider=provider)
                model = get_text_model_for_provider(provider)
            prompt = build_reference_authority_prompt(
                normalized_asr_entries,
                reference,
                source_language=source_language,
                split_config=split_config,
                retry_index=attempt,
                failure_reason=last_error,
            )
            response = generate_content(
                client,
                model=model,
                contents=prompt,
                response_mime_type="application/json",
                provider=provider,
            )
            results = parse_json_array_from_text(getattr(response, "text", response))
            validated = parse_direct_reference_authority_subtitles(results, reference)
            if not validated:
                attempt_error = "模型未按原稿输出可用字幕 JSON"
            if not validated:
                append_reference_authority_debug_event({
                    "attempt": attempt + 1,
                    "max_attempts": max_attempts,
                    "reason": attempt_error or "unknown_validation_failure",
                    "reference_text": reference,
                    "asr_segments": reference_authority_asr_debug_segments(normalized_asr_entries),
                    "llm_results": results,
                })
            if validated:
                if attempt > 0:
                    print(f"   ✅ 参考文本权威分配重试成功: 第 {attempt + 1} 次")
                return validated
            last_error = attempt_error or "参考文本权威分配未返回可用 JSON"
            print(f"   ⚠️ {last_error}，准备重试。" if attempt + 1 < max_attempts else f"   ⚠️ {last_error}。")
        except Exception as err:
            last_error = str(err)
            if attempt + 1 < max_attempts:
                print(f"   ⚠️ 参考文本权威分配失败，准备重试: {err}")
                time.sleep(min(1.5, 0.4 * (attempt + 1)))
                continue
            if strict:
                raise ReferenceAuthorityAlignmentError(f"参考文本权威分配失败: {err}") from err
            print(f"   ⚠️ 参考文本权威分配失败: {err}")
            return []

    if strict:
        raise ReferenceAuthorityAlignmentError(last_error or "参考文本权威分配未返回可用 JSON")
    print("   ⚠️ 参考文本权威分配未返回可用 JSON。")
    return []


def asr_entry_text_matches_reference(entry, reference_text):
    asr_visible = normalize_visible_text_for_reference_match(get_subtitle_primary_text(entry))
    reference_visible = normalize_visible_text_for_reference_match(reference_text)
    if len(asr_visible) < 2 or not reference_visible:
        return False
    if asr_visible in reference_visible:
        return True
    if len(asr_visible) < 4:
        return False

    max_anchor_len = min(len(asr_visible), 14)
    for size in range(max_anchor_len, 3, -1):
        if asr_visible[:size] in reference_visible or asr_visible[-size:] in reference_visible:
            return True
    return False


def asr_entry_text_matches_reference_prefix(entry, reference_text):
    asr_visible = normalize_visible_text_for_reference_match(get_subtitle_primary_text(entry))
    reference_visible = normalize_visible_text_for_reference_match(reference_text)
    if len(asr_visible) < 2 or not reference_visible:
        return False
    if reference_visible.startswith(asr_visible):
        return True
    prefix_len = common_prefix_length(asr_visible, reference_visible)
    required = min(len(asr_visible), 6)
    if len(asr_visible) <= 4:
        required = len(asr_visible)
    return prefix_len >= max(2, required)


def asr_entry_should_belong_to_next_reference(entry, reference_text, next_reference_text):
    if not next_reference_text:
        return False
    asr_visible = normalize_visible_text_for_reference_match(get_subtitle_primary_text(entry))
    reference_visible = normalize_visible_text_for_reference_match(reference_text)
    next_visible = normalize_visible_text_for_reference_match(next_reference_text)
    if len(asr_visible) < 2 or len(asr_visible) > REFERENCE_AUTHORITY_NEXT_PREFIX_MAX_VISIBLE_CHARS:
        return False
    next_prefix_len = common_prefix_length(asr_visible, next_visible)
    if next_prefix_len < max(2, min(len(asr_visible), 6)):
        return False
    current_suffix_len = common_suffix_length(asr_visible, reference_visible)
    return current_suffix_len < max(2, min(len(asr_visible), 4))


def collect_asr_entries_for_reference(asr_entries, reference_entry, used_indices, next_reference_entry=None):
    ref_time = subtitle_time_range(reference_entry)
    if not ref_time:
        return []
    ref_start, ref_end = ref_time
    reference_text = get_subtitle_primary_text(reference_entry)
    next_reference_text = get_subtitle_primary_text(next_reference_entry) if next_reference_entry else ""

    selected = []
    for index, entry in enumerate(asr_entries):
        if index in used_indices:
            continue
        entry_time = subtitle_time_range(entry)
        if not entry_time:
            continue
        start, end = entry_time
        center = (start + end) / 2.0
        if time_overlap_ratio(start, end, ref_start, ref_end) > 0 or ref_start <= center <= ref_end:
            selected.append((index, entry))

    if selected and next_reference_text:
        while len(selected) > 1:
            _index, entry = selected[-1]
            entry_time = subtitle_time_range(entry)
            gap_to_next = min(
                abs(ref_end - entry_time[0]),
                abs(ref_end - entry_time[1]),
            ) if entry_time else 0
            if gap_to_next > REFERENCE_AUTHORITY_NEXT_PREFIX_MAX_GAP_SECONDS:
                break
            if not asr_entry_should_belong_to_next_reference(entry, reference_text, next_reference_text):
                break
            selected.pop()

    first_selected_index = selected[0][0] if selected else len(asr_entries)
    for index, entry in enumerate(asr_entries[:first_selected_index]):
        if index in used_indices:
            continue
        entry_time = subtitle_time_range(entry)
        if not entry_time:
            continue
        start, end = entry_time
        if end < ref_start - REFERENCE_AUTHORITY_NEXT_PREFIX_MAX_GAP_SECONDS:
            continue
        if start - ref_start > REFERENCE_AUTHORITY_NEXT_PREFIX_MAX_GAP_SECONDS:
            continue
        if asr_entry_text_matches_reference_prefix(entry, reference_text):
            selected.insert(0, (index, entry))
            break

    if selected:
        cursor = selected[-1][0] + 1
        while cursor < len(asr_entries):
            if cursor in used_indices:
                break
            entry = asr_entries[cursor]
            if next_reference_text and asr_entry_text_matches_reference(entry, next_reference_text):
                break
            if not asr_entry_text_matches_reference(entry, reference_text):
                break
            selected.append((cursor, entry))
            cursor += 1

    while len(selected) > 1:
        _index, entry = selected[0]
        text = get_subtitle_primary_text(entry)
        if asr_entry_text_matches_reference_prefix(entry, reference_text):
            break
        if has_cjk(reference_text) and is_english_like(text) and not has_cjk(text):
            break
        if (
            asr_entry_text_matches_reference(entry, reference_text)
            and readable_visible_len(text) > 8
            and subtitle_duration(entry) > 1.1
        ):
            break
        if (
            not asr_entry_text_matches_reference(entry, reference_text)
            and readable_visible_len(text) > 8
            and subtitle_duration(entry) > 1.1
        ):
            break
        selected.pop(0)

    while len(selected) > 1:
        _index, entry = selected[-1]
        text = get_subtitle_primary_text(entry)
        if asr_entry_text_matches_reference(entry, reference_text):
            break
        if next_reference_text and asr_entry_text_matches_reference(entry, next_reference_text):
            selected.pop()
            continue
        if readable_visible_len(text) > 2 and subtitle_duration(entry) > 0.8:
            break
        selected.pop()

    return selected


REFERENCE_AUTHORITY_DUPLICATE_REF_MAX_GAP_SECONDS = 0.35
REFERENCE_AUTHORITY_DUPLICATE_REF_MIN_VISIBLE_CHARS = 12


def reference_authority_duplicate_text(left, right) -> bool:
    left_visible = visible_text(get_subtitle_primary_text(left)).lower()
    right_visible = visible_text(get_subtitle_primary_text(right)).lower()
    if (
        len(left_visible) < REFERENCE_AUTHORITY_DUPLICATE_REF_MIN_VISIBLE_CHARS
        or len(right_visible) < REFERENCE_AUTHORITY_DUPLICATE_REF_MIN_VISIBLE_CHARS
    ):
        return False
    return left_visible == right_visible or left_visible in right_visible or right_visible in left_visible


def merge_reference_authority_reference_entries(reference_entries):
    """Collapse adjacent duplicate reference subtitles before assigning ASR timing."""

    normalized = normalize_final_subtitles(reference_entries)
    if len(normalized) <= 1:
        return normalized

    merged = []
    merge_count = 0
    for entry in normalized:
        current_time = subtitle_time_range(entry)
        previous_time = subtitle_time_range(merged[-1]) if merged else None
        if (
            merged
            and previous_time
            and current_time
            and current_time[0] - previous_time[1] <= REFERENCE_AUTHORITY_DUPLICATE_REF_MAX_GAP_SECONDS
            and reference_authority_duplicate_text(merged[-1], entry)
        ):
            updated = dict(merged[-1])
            updated["time"] = [previous_time[0], current_time[1]]
            if readable_visible_len(get_subtitle_primary_text(entry)) > readable_visible_len(get_subtitle_primary_text(updated)):
                for key in ("zh", "text", "en"):
                    if str(entry.get(key) or "").strip():
                        updated[key] = entry[key]
            merged[-1] = updated
            merge_count += 1
            continue
        merged.append(entry)

    if merge_count:
        print(f"   ✅ 已折叠重复参考字幕时间块: {merge_count} 处")
    return merged


def build_reference_authority_subtitles(
    asr_subtitles,
    reference_subtitles,
    split_config=None,
    source_language="",
    use_llm=True,
    strict=False,
):
    """Ask the LLM for final subtitles while keeping reference text as the only text source."""

    if not reference_subtitles:
        return asr_subtitles

    asr_entries = normalize_final_subtitles(asr_subtitles)
    if not asr_entries:
        if strict:
            raise ReferenceAuthorityAlignmentError("参考文本权威模式未获得可验证 ASR 句段")
        return normalize_final_subtitles(reference_subtitles)
    if strict and not use_llm and len(asr_entries) > 1:
        raise ReferenceAuthorityAlignmentError("严格参考文本权威模式需要通过 LLM 分配验证")

    reference_entries = sorted(
        [entry for entry in reference_subtitles if subtitle_time_range(entry)],
        key=lambda item: subtitle_time_range(item)[0]
    )
    reference_text = "".join(get_subtitle_primary_text(entry) for entry in reference_entries).strip()
    if not reference_text:
        if strict:
            raise ReferenceAuthorityAlignmentError("参考文本权威模式未获得参考口播稿")
        return normalize_final_subtitles(reference_subtitles)

    if not use_llm:
        if strict:
            raise ReferenceAuthorityAlignmentError("严格参考文本权威模式需要大模型直接输出字幕")
        return normalize_final_subtitles(reference_subtitles)

    try:
        output = align_reference_authority_with_llm(
            asr_entries,
            reference_text,
            source_language=source_language,
            split_config=split_config,
            strict=strict,
        )
    except ReferenceAuthorityAlignmentError:
        raise

    if not output and strict:
        raise ReferenceAuthorityAlignmentError("参考文本权威分配未返回可用 JSON")
    if not output:
        return []
    print(f"   ✅ 已按 ASR 句段时间轴套用参考文本权威字幕: {len(output)} 条")
    return output


def repair_subtitles_with_reference_terms(subtitles, reference_subtitles):
    if not subtitles or not reference_subtitles:
        return subtitles

    repaired_count = 0
    for entry in subtitles:
        if not isinstance(entry, dict):
            continue
        time_range = entry.get("time")
        if not isinstance(time_range, list) or len(time_range) < 2:
            continue
        start = parse_seconds(time_range[0], milliseconds=False)
        end = parse_seconds(time_range[1], milliseconds=False)
        if start is None or end is None or end <= start:
            continue

        current_text = str(entry.get("zh") or entry.get("text") or entry.get("en") or "").strip()
        reference_context = summarize_reference_context(reference_subtitles, start, end)
        if not reference_context:
            continue
        reference_text = select_reference_context_for_asr(reference_context, current_text)

        original_zh = str(entry.get("zh") or "").strip()
        if original_zh:
            repaired_zh = apply_domain_corrections(
                repair_reference_subtitle_text(original_zh, reference_text)
            )
            if repaired_zh == original_zh and reference_context != reference_text:
                repaired_zh = apply_domain_corrections(
                    repair_reference_subtitle_text(original_zh, reference_context)
                )
            if repaired_zh != original_zh:
                entry["zh"] = repaired_zh
                entry["text"] = repaired_zh
                repaired_count += 1

        original_text = str(entry.get("text") or "").strip()
        if original_text:
            repaired_text = apply_domain_corrections(
                repair_reference_subtitle_text(original_text, reference_text)
            )
            if repaired_text == original_text and reference_context != reference_text:
                repaired_text = apply_domain_corrections(
                    repair_reference_subtitle_text(original_text, reference_context)
                )
            if repaired_text != original_text:
                entry["text"] = repaired_text
                if not entry.get("zh"):
                    entry["zh"] = repaired_text
                repaired_count += 1

        original_en = str(entry.get("en") or "").strip()
        if original_en:
            repaired_en = repair_reference_subtitle_text(original_en, reference_text)
            if repaired_en == original_en and reference_context != reference_text:
                repaired_en = repair_reference_subtitle_text(original_en, reference_context)
            if repaired_en != original_en:
                entry["en"] = repaired_en
                repaired_count += 1

    if repaired_count:
        print(f"   ✅ 已按参考文本补齐关键字幕项: {repaired_count} 条")
    return subtitles


def refine_subtitles_with_llm(subtitles, source_language="", batch_size=24):
    targets = []
    for index, entry in enumerate(subtitles or []):
        if not isinstance(entry, dict):
            continue
        time_range = entry.get("time")
        if not isinstance(time_range, list) or len(time_range) < 2:
            continue
        start = parse_seconds(time_range[0], milliseconds=False)
        end = parse_seconds(time_range[1], milliseconds=False)
        if start is None or end is None or end <= start:
            continue

        zh_text = str(entry.get("zh") or entry.get("text") or "").strip()
        en_text = str(entry.get("en") or "").strip()
        primary_text = str(entry.get("text") or zh_text or en_text or "").strip()
        if not (zh_text or en_text or primary_text):
            continue

        combined_terms_text = f"{zh_text}\n{en_text}\n{primary_text}"
        preserve_terms = extract_preserve_terms(combined_terms_text)
        _masked_combined, placeholders = mask_preserved_terms(combined_terms_text, preserve_terms)
        masked_zh, _ = mask_preserved_terms(zh_text, preserve_terms)
        masked_en, _ = mask_preserved_terms(en_text, preserve_terms)
        masked_text, _ = mask_preserved_terms(primary_text, preserve_terms)
        targets.append({
            "index": index,
            "time": [start, end],
            "zh": masked_zh,
            "en": masked_en,
            "text": masked_text,
            "placeholders": placeholders,
        })

    if not targets:
        return subtitles

    emit_stage("subtitle_refine", f"正在调用大模型精修 {len(targets)} 条字幕")
    provider = get_text_llm_provider()
    client = create_llm_client(provider=provider)
    model = get_text_model_for_provider(provider)
    prompt_template = load_prompt_text("run_asr_skill.md", "Refine Translate Prompt")
    prompt_template = (
        prompt_template
        + "\n\n补充要求：每条输出必须包含输入里的 index 字段，方便按原条目回写。"
        + "payload 中的 placeholders 映射只是候选保护项。"
        + "只有当映射值是真实专有名词、公司/产品/协议名称、ticker、股票代码、常用缩写、法案名或账号名时，zh 才可以保留对应 [[TERM_n]]。"
        + "如果映射值是普通英文单词、连接词、语气词、序数词、描述性短语或句首过渡词，zh 必须翻译成简体中文，不要输出该占位符。"
        + "即使映射值是候选专有名词，只要它在中文财经/科技/加密语境里有稳定通用中文译名，zh 必须使用中文译名，不要输出该占位符。"
        + "孤立单字母、残缺英文片段、ASR 听错的英文碎片，除非是明确 ticker、股票代码、常用缩写或账号名，否则必须结合上下文纠正、翻译或删去。"
        + "zh 最终文本禁止出现被中文标点、空格或句首句尾孤立包围的单个拉丁字母。"
        + "zh 字段必须使用简体中文。"
    )

    updated_count = 0
    for batch in chunked(targets, batch_size):
        prompt = prompt_template.format(
            source_language=source_language or "auto",
            payload=json.dumps(batch, ensure_ascii=False)
        )
        response = generate_content(
            client,
            model=model,
            contents=prompt,
            response_mime_type="application/json",
            provider=provider
        )
        results = parse_json_array_from_text(getattr(response, "text", response))
        target_lookup = {item["index"]: item for item in batch if isinstance(item, dict) and "index" in item}
        for fallback_offset, item in enumerate(results):
            if not isinstance(item, dict):
                continue
            fallback_index = batch[fallback_offset]["index"] if fallback_offset < len(batch) else None
            try:
                index = int(item.get("index", fallback_index))
            except (TypeError, ValueError):
                continue
            if not (0 <= index < len(subtitles)):
                continue

            placeholders = target_lookup.get(index, {}).get("placeholders") or {}
            zh_text = str(item.get("zh") or "").strip()
            en_text = str(item.get("en") or "").strip()
            if zh_text:
                restored_zh = restore_preserved_terms(zh_text, placeholders)
                restored_en = restore_preserved_terms(en_text, placeholders)
                original_en = str(subtitles[index].get("en") or "").strip()
                original_text = str(subtitles[index].get("text") or "").strip()
                subtitles[index]["zh"] = repair_subtitle_text_with_sources(
                    restored_zh,
                    original_text,
                    restored_en,
                    original_en,
                )
            if en_text:
                subtitles[index]["en"] = to_simplified_chinese(
                    restore_preserved_terms(en_text, placeholders)
                )
            if subtitles[index].get("zh"):
                subtitles[index]["text"] = subtitles[index]["zh"]
            elif subtitles[index].get("en"):
                subtitles[index]["text"] = subtitles[index]["en"]
            updated_count += 1

    print(f"   ✅ 已完成大模型字幕精修: {updated_count}/{len(targets)}")
    return subtitles


def get_subtitle_primary_text(entry):
    if not isinstance(entry, dict):
        return ""
    return str(entry.get("zh") or entry.get("text") or entry.get("en") or "").strip()


def build_reference_visible_texts(reference_subtitles):
    texts = []
    for item in reference_subtitles or []:
        text = get_subtitle_primary_text(item)
        normalized = visible_text(text)
        if normalized:
            texts.append(normalized)
    return texts


def reference_contains_contiguous_text(left_text, right_text, reference_visible_texts):
    combined = visible_text(f"{left_text}{right_text}")
    if not combined:
        return False
    return any(combined in ref_text for ref_text in reference_visible_texts)


def forms_split_data_token(left_text, right_text):
    left = re.sub(r"\s+", "", str(left_text or ""))
    right = re.sub(r"\s+", "", str(right_text or ""))
    if not left or not right:
        return False
    return bool(
        (re.search(r"\d[.,]$", left) and re.match(r"^\d", right))
        or (re.search(r"\d$", left) and re.match(r"^[.,]\d", right))
        or (re.search(r"\d$", left) and right.startswith("%"))
        or (left.endswith("$") and re.match(r"[A-Za-z0-9]", right))
    )


def is_short_orphan_subtitle(text):
    normalized = visible_text(text)
    return 0 < len(normalized) <= 2


def should_merge_reference_continuation(previous, current, reference_visible_texts):
    previous_text = get_subtitle_primary_text(previous)
    current_text = get_subtitle_primary_text(current)
    if not previous_text or not current_text:
        return False
    if forms_split_data_token(previous_text, current_text):
        return True
    return (
        is_short_orphan_subtitle(current_text)
        and reference_contains_contiguous_text(previous_text, current_text, reference_visible_texts)
    )


GENERIC_LOCATION_PREFIX_PATTERN = re.compile(r"^[\u4e00-\u9fff]{1,8}上[，,、\s]*")
DUPLICATE_PREFIX_STRIP_CHARS = " \t\r\n，,、。.!?！？；;：:"
DUPLICATE_PREFIX_WORD_PATTERN = re.compile(r"[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)?")
DUPLICATE_PREFIX_MIN_VISIBLE_CHARS = 4
DUPLICATE_PREFIX_MIN_WORDS = 3
DUPLICATE_PREFIX_MAX_WORDS = 10


def strip_duplicate_prefix_boundary(text):
    return str(text or "").lstrip(DUPLICATE_PREFIX_STRIP_CHARS)


def raw_index_after_visible_prefix(text, visible_length):
    if visible_length <= 0:
        return 0

    count = 0
    for index, char in enumerate(str(text or "")):
        visible_char = visible_text(char)
        if not visible_char:
            continue
        count += len(visible_char)
        if count >= visible_length:
            return index + 1
    return None


def trim_duplicate_visible_prefix(previous_text, current_text, min_overlap=DUPLICATE_PREFIX_MIN_VISIBLE_CHARS):
    current = str(current_text or "")
    previous_visible = visible_text(previous_text).lower()
    current_visible = visible_text(current).lower()
    if len(previous_visible) < min_overlap or len(current_visible) < min_overlap:
        return current

    max_overlap = min(len(previous_visible), len(current_visible))
    for overlap_length in range(max_overlap, min_overlap - 1, -1):
        if not previous_visible.endswith(current_visible[:overlap_length]):
            continue
        raw_index = raw_index_after_visible_prefix(current, overlap_length)
        if raw_index is None:
            continue
        trimmed = strip_duplicate_prefix_boundary(current[raw_index:])
        if visible_text(trimmed):
            return trimmed
        return current
    return current


def normalize_duplicate_word(word):
    normalized = str(word or "").lower()
    if normalized.endswith("'s"):
        normalized = normalized[:-2]
    if len(normalized) > 3 and normalized.endswith("s"):
        normalized = normalized[:-1]
    return normalized


def duplicate_words_with_spans(text):
    words = []
    for match in DUPLICATE_PREFIX_WORD_PATTERN.finditer(str(text or "")):
        normalized = normalize_duplicate_word(match.group(0))
        if normalized:
            words.append((normalized, match.start(), match.end()))
    return words


def trim_duplicate_latin_prefix(previous_text, current_text):
    current = str(current_text or "")
    previous_words = [word for word, _start, _end in duplicate_words_with_spans(previous_text)]
    current_words = duplicate_words_with_spans(current)
    if len(previous_words) < DUPLICATE_PREFIX_MIN_WORDS or len(current_words) < DUPLICATE_PREFIX_MIN_WORDS:
        return current

    max_overlap = min(len(previous_words), len(current_words), DUPLICATE_PREFIX_MAX_WORDS)
    current_normalized = [word for word, _start, _end in current_words]
    for overlap_length in range(max_overlap, DUPLICATE_PREFIX_MIN_WORDS - 1, -1):
        if previous_words[-overlap_length:] != current_normalized[:overlap_length]:
            continue
        trim_end = current_words[overlap_length - 1][2]
        trimmed = strip_duplicate_prefix_boundary(current[trim_end:])
        if re.search(r"[A-Za-z0-9\u4e00-\u9fff]", trimmed):
            return trimmed
        return current
    return current


def trim_reference_duplicate_prefix(previous, current, reference_visible_texts):
    previous_text = get_subtitle_primary_text(previous)
    current_text = get_subtitle_primary_text(current)
    if not previous_text or not current_text:
        return current, False

    updated = None

    duplicate_trimmed_text = trim_duplicate_visible_prefix(previous_text, current_text)
    if duplicate_trimmed_text != current_text:
        updated = dict(current)
        if str(updated.get("zh") or "").strip():
            updated["zh"] = duplicate_trimmed_text
        updated["text"] = duplicate_trimmed_text
        current = updated
        current_text = duplicate_trimmed_text

    previous_en = str(previous.get("en") or "").strip()
    current_en = str(current.get("en") or "").strip()
    if previous_en and current_en:
        trimmed_en = trim_duplicate_latin_prefix(previous_en, current_en)
        if trimmed_en == current_en:
            trimmed_en = trim_duplicate_visible_prefix(previous_en, current_en, min_overlap=8)
        if trimmed_en != current_en:
            updated = dict(current)
            updated["en"] = trimmed_en
            current = updated

    if updated is not None:
        return current, True

    match = GENERIC_LOCATION_PREFIX_PATTERN.match(current_text)
    if not match:
        return current, False

    trimmed_text = current_text[match.end():].lstrip("，,、 ")
    if not trimmed_text:
        return current, False

    previous_visible = visible_text(previous_text)
    current_visible = visible_text(current_text)
    trimmed_visible = visible_text(trimmed_text)
    if not (previous_visible and current_visible and trimmed_visible):
        return current, False

    original_combined = f"{previous_visible}{current_visible}"
    trimmed_combined = f"{previous_visible}{trimmed_visible}"
    location_suffix_combined = f"{previous_visible}上{trimmed_visible}"
    if any(original_combined in ref_text for ref_text in reference_visible_texts):
        return current, False
    if not any(
        trimmed_combined in ref_text or location_suffix_combined in ref_text
        for ref_text in reference_visible_texts
    ):
        return current, False

    updated = dict(current)
    for key in ("zh", "text"):
        if str(updated.get(key) or "").strip() == current_text:
            updated[key] = trimmed_text
    return updated, True


def join_subtitle_text(left_text, right_text):
    left = str(left_text or "").strip()
    right = str(right_text or "").strip()
    if not left:
        return right
    if not right:
        return left
    if forms_split_data_token(left, right):
        return f"{left}{right}"
    if re.search(r"[\u4e00-\u9fff]$", left) or re.match(r"^[\u4e00-\u9fff]", right):
        return f"{left}{right}"
    return f"{left} {right}"


def merge_subtitle_entries(previous, current):
    merged = dict(previous)
    previous_time = previous.get("time") if isinstance(previous.get("time"), list) else [previous.get("start"), previous.get("end")]
    current_time = current.get("time") if isinstance(current.get("time"), list) else [current.get("start"), current.get("end")]
    start = parse_seconds(previous_time[0], milliseconds=False)
    end = parse_seconds(current_time[1], milliseconds=False)
    if start is not None and end is not None and end > start:
        merged["time"] = [start, end]

    previous_text = get_subtitle_primary_text(previous)
    current_text = get_subtitle_primary_text(current)
    merged_text = apply_domain_corrections(join_subtitle_text(previous_text, current_text))
    merged["zh"] = merged_text
    merged["text"] = merged_text

    previous_en = str(previous.get("en") or "").strip()
    current_en = str(current.get("en") or "").strip()
    if previous_en and current_en and forms_split_data_token(previous_en, current_en):
        merged["en"] = join_subtitle_text(previous_en, current_en)
    elif previous_en:
        merged["en"] = previous_en
    elif current_en:
        merged["en"] = current_en

    return merged


def merge_reference_continuations(subtitles, reference_subtitles):
    if not subtitles or not reference_subtitles:
        return subtitles

    reference_visible_texts = build_reference_visible_texts(reference_subtitles)
    if not reference_visible_texts:
        return subtitles

    merged = []
    merge_count = 0
    trim_count = 0
    for entry in subtitles:
        if merged and should_merge_reference_continuation(merged[-1], entry, reference_visible_texts):
            merged[-1] = merge_subtitle_entries(merged[-1], entry)
            merge_count += 1
        else:
            if merged:
                entry, trimmed = trim_reference_duplicate_prefix(merged[-1], entry, reference_visible_texts)
                if trimmed:
                    trim_count += 1
            merged.append(entry)

    if merge_count:
        print(f"   ✅ 已合并参考文本连续字幕碎片: {merge_count} 处")
    if trim_count:
        print(f"   ✅ 已清理参考文本相邻重复前缀: {trim_count} 处")
    return merged


def normalize_final_subtitles(subtitles):
    normalized = []
    dropped_count = 0
    for entry in subtitles or []:
        if not isinstance(entry, dict):
            dropped_count += 1
            continue

        time_range = entry.get("time")
        if not isinstance(time_range, list) or len(time_range) < 2:
            time_range = [entry.get("start"), entry.get("end")]
        start = parse_seconds(time_range[0], milliseconds=False)
        end = parse_seconds(time_range[1], milliseconds=False)
        text = get_subtitle_primary_text(entry)
        if start is None or end is None or end <= start or not text:
            dropped_count += 1
            continue

        item = dict(entry)
        item["time"] = [start, end]
        if str(item.get("zh") or "").strip():
            item["zh"] = str(item.get("zh")).strip()
        if str(item.get("text") or "").strip():
            item["text"] = str(item.get("text")).strip()
        else:
            item["text"] = text
        if str(item.get("en") or "").strip():
            item["en"] = str(item.get("en")).strip()
        normalized.append(item)

    if dropped_count:
        print(f"   ✅ 已丢弃无效字幕片段: {dropped_count} 条")
    return normalized


def backfill_chinese_subtitles(subtitles, source_language="", batch_size=40):
    subtitles = normalize_subtitles_to_simplified(subtitles)
    targets = []
    for index, entry in enumerate(subtitles):
        zh_text = str(entry.get("zh") or entry.get("text") or "").strip()
        en_text = str(entry.get("en") or "").strip()
        source_text = en_text or zh_text
        if not source_text:
            continue
        if has_cjk(zh_text) and zh_text != en_text:
            continue
        if is_english_language(source_language) or is_english_like(source_text) or not has_cjk(zh_text):
            masked_text, placeholders = mask_preserved_terms(source_text)
            targets.append({
                "index": index,
                "text": masked_text,
                "placeholders": placeholders,
                "source_text": source_text
            })

    if not targets:
        return subtitles

    emit_stage("subtitle_translate", f"正在翻译 {len(targets)} 条中文字幕")
    provider = get_text_llm_provider()
    client = create_llm_client(provider=provider)
    model = get_text_model_for_provider(provider)
    prompt_template = load_prompt_text("run_asr_skill.md", "Chinese Backfill Prompt")
    prompt_template = (
        prompt_template
        + "\n\n补充要求：payload 中的 placeholders 映射只是候选保护项。"
        + "只有当映射值是真实专有名词、公司/产品/协议名称、ticker、股票代码、常用缩写、法案名或账号名时，zh 才可以保留对应 [[TERM_n]]。"
        + "如果映射值是普通英文单词、连接词、语气词、序数词、描述性短语或句首过渡词，zh 必须翻译成简体中文，不要输出该占位符。"
        + "即使映射值是候选专有名词，只要它在中文财经/科技/加密语境里有稳定通用中文译名，zh 必须使用中文译名，不要输出该占位符。"
        + "孤立单字母、残缺英文片段、ASR 听错的英文碎片，除非是明确 ticker、股票代码、常用缩写或账号名，否则必须结合上下文纠正、翻译或删去。"
        + "zh 最终文本禁止出现被中文标点、空格或句首句尾孤立包围的单个拉丁字母。"
    )

    translated_count = 0
    for batch in chunked(targets, batch_size):
        prompt = prompt_template.format(payload=json.dumps(batch, ensure_ascii=False))
        response = generate_content(
            client,
            model=model,
            contents=prompt,
            response_mime_type="application/json",
            provider=provider
        )
        results = parse_json_array_from_text(getattr(response, "text", response))
        target_lookup = {item["index"]: item for item in batch if isinstance(item, dict) and "index" in item}
        for item in results:
            if not isinstance(item, dict):
                continue
            try:
                index = int(item.get("index"))
            except (TypeError, ValueError):
                continue
            zh_text = str(item.get("zh") or "").strip()
            if 0 <= index < len(subtitles) and zh_text:
                placeholders = target_lookup.get(index, {}).get("placeholders") or {}
                restored_text = restore_preserved_terms(zh_text, placeholders)
                source_text = str(target_lookup.get(index, {}).get("source_text") or "").strip()
                subtitles[index]["zh"] = repair_subtitle_text_with_sources(restored_text, source_text)
                translated_count += 1

    print(f"   ✅ 已补全中文字幕: {translated_count}/{len(targets)}")
    return subtitles


def transcribe_raw_segments(model, audio_file, language=None, stage_label="auto", split_config=None):
    language_kwargs = {"language": language} if language else {}
    print(f"   -> Whisper 转写模式: {stage_label}")
    segments, info = model.transcribe(
        audio_file,
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        **language_kwargs
    )

    detected_language = str(getattr(info, "language", "") or "").strip().lower()
    raw_segments = []
    for segment in segments:
        sub_segments = split_segment_words(segment, split_config=split_config)
        for item in sub_segments:
            raw_segments.append(item)
            print(f"   [ASR {stage_label}]: {item['text']}")
    return raw_segments, detected_language


def merge_rescue_segments(primary_segments, rescue_segments):
    merged = list(primary_segments or [])
    for rescue in rescue_segments or []:
        rescue_text = str(rescue.get("text", "")).strip()
        if not rescue_text or not is_english_like(rescue_text):
            continue

        overlapped = False
        for current in merged:
            ratio = time_overlap_ratio(
                current.get("start", 0.0),
                current.get("end", 0.0),
                rescue.get("start", 0.0),
                rescue.get("end", 0.0)
            )
            if ratio >= 0.45:
                overlapped = True
                break
        if not overlapped:
            merged.append(rescue)

    merged.sort(key=lambda item: (float(item.get("start", 0.0)), float(item.get("end", 0.0))))
    return merged


def build_raw_segments(audio_file, split_config=None, force_english_rescue=False):
    emit_stage("asr", "正在进行 Whisper ASR 识别")
    print("1. 正在加载 Whisper 模型进行 ASR 识别...")
    model = WhisperModel("small", device="cpu", compute_type="int8")

    print("2. Whisper 模型加载完毕！开始识别语音...")
    raw_segments, detected_language = transcribe_raw_segments(
        model,
        audio_file,
        language=None,
        stage_label="auto",
        split_config=split_config
    )

    # 对“中文主语种但夹杂英文口播”的视频，补做一次英文转写，把主识别漏掉的英语时间段补回来。
    if force_english_rescue or is_chinese_language(detected_language):
        try:
            english_segments, _ = transcribe_raw_segments(
                model,
                audio_file,
                language="en",
                stage_label="en-rescue",
                split_config=split_config
            )
            before_count = len(raw_segments)
            raw_segments = merge_rescue_segments(raw_segments, english_segments)
            rescued_count = len(raw_segments) - before_count
            if rescued_count > 0:
                print(f"   ✅ 英文补救转写已补回 {rescued_count} 条英语片段")
        except Exception as err:
            print(f"   ⚠️ 英文补救转写失败，继续使用主识别结果: {err}")
    return raw_segments, detected_language


def video_has_audio_stream(input_video: str) -> bool:
    probe = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-select_streams", "a",
            "-show_entries", "stream=index",
            "-of", "json",
            input_video
        ],
        capture_output=True,
        text=True,
        encoding="utf-8"
    )
    if probe.returncode != 0:
        raise RuntimeError(f"ffprobe 检测音轨失败: {probe.stderr.strip() or probe.stdout.strip() or 'unknown error'}")
    try:
        payload = json.loads(probe.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"ffprobe 输出解析失败: {exc}") from exc
    return bool(payload.get("streams") or [])


def main():
    parser = argparse.ArgumentParser(description="ASR and Translation script.")
    parser.add_argument("--input", default="aiman.mp4", help="Input video file.")
    parser.add_argument("--file-url", default="", help="Public audio/video URL for DashScope Filetrans ASR.")
    parser.add_argument("--allow-no-audio", action="store_true", help="Allow silent videos and generate empty subtitle files instead of failing.")
    parser.add_argument("--audio-json", default="audio.json", help="Output audio timeline JSON file.")
    parser.add_argument("--subtitles-json", default="subtitles.json", help="Output subtitles JSON file.")
    parser.add_argument("--speaker-scene-json", default="speaker_scene.json", help="Output speaker/scene JSON file.")
    parser.add_argument("--reference-subtitles-json", default="", help="Reference subtitle JSON file used to align ASR timing with more accurate text.")
    parser.add_argument("--max-chunk-duration", type=float, default=DEFAULT_SPLIT_CONFIG["max_chunk_duration"], help="Maximum subtitle chunk duration in seconds.")
    parser.add_argument("--soft-chunk-duration", type=float, default=DEFAULT_SPLIT_CONFIG["soft_chunk_duration"], help="Preferred subtitle chunk duration in seconds.")
    parser.add_argument("--max-visible-chars", type=int, default=DEFAULT_SPLIT_CONFIG["max_visible_chars"], help="Maximum visible characters before forcing a split.")
    parser.add_argument("--max-words-per-chunk", type=int, default=DEFAULT_SPLIT_CONFIG["max_words_per_chunk"], help="Maximum token count before forcing a split.")
    parser.add_argument("--pause-threshold", type=float, default=DEFAULT_SPLIT_CONFIG["pause_threshold"], help="Pause threshold in seconds for natural splits.")
    parser.add_argument("--force-english-rescue", action="store_true", help="Always run an extra English rescue transcription pass.")
    parser.add_argument("--translate-subtitles", action="store_true", help="Backfill Chinese subtitles with the configured text LLM.")
    parser.add_argument("--refine-subtitles", action="store_true", help="Run an LLM subtitle refinement pass without changing timing.")
    parser.add_argument("--reference-text-authority", action="store_true", help="Use ASR only for timing and keep reference subtitles as the final subtitle text authority.")
    args = parser.parse_args()
    input_video = args.input
    audio_json_path = args.audio_json
    subtitles_json_path = args.subtitles_json
    speaker_scene_json_path = args.speaker_scene_json
    reference_subtitles = read_reference_subtitles(args.reference_subtitles_json)

    emit_stage("audio_probe", f"正在检测视频音轨: {input_video}")
    if not video_has_audio_stream(input_video):
        if args.allow_no_audio:
            print("0. 检测到输入视频无音轨，已切换为空字幕降级模式。")
            with open(audio_json_path, "w", encoding="utf-8") as f:
                json.dump([], f, ensure_ascii=False, indent=2)
            with open(subtitles_json_path, "w", encoding="utf-8") as f:
                json.dump([], f, ensure_ascii=False, indent=2)
            emit_result(
                "输入视频无音轨，已生成空字幕文件",
                audio_json=audio_json_path,
                subtitles_json=subtitles_json_path,
                segment_count=0,
                no_audio_stream=True,
            )
            return
        raise RuntimeError(f"输入视频没有可用音轨: {input_video}")

    emit_stage("audio_extract", f"正在从视频中提取音频: {input_video}")
    print(f"0. 正在从视频 '{input_video}' 中提取音频...")
    audio_file = os.path.splitext(os.path.basename(input_video))[0] + "_audio.mp3"

    subprocess.run(
        ["ffmpeg", "-y", "-i", input_video, "-q:a", "0", "-map", "a", audio_file],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )

    if not os.path.exists(audio_file):
        print(f"❌ 提取音频失败！请检查 {input_video} 是否存在。")
        sys.exit(1)

    start_time = time.time()
    split_config = resolve_split_config({
        "max_chunk_duration": args.max_chunk_duration,
        "soft_chunk_duration": args.soft_chunk_duration,
        "max_visible_chars": args.max_visible_chars,
        "max_words_per_chunk": args.max_words_per_chunk,
        "pause_threshold": args.pause_threshold,
    })
    print(
        "0.1 使用字幕切分参数: "
        f"max_chunk_duration={split_config['max_chunk_duration']}, "
        f"soft_chunk_duration={split_config['soft_chunk_duration']}, "
        f"max_visible_chars={split_config['max_visible_chars']}, "
        f"max_words_per_chunk={split_config['max_words_per_chunk']}, "
        f"pause_threshold={split_config['pause_threshold']}, "
        f"force_english_rescue={args.force_english_rescue}"
    )
    raw_segments = []
    detected_language = "zh"
    
    if get_llm_provider() == "qwen" and (os.getenv("QWEN_API_KEY") or os.getenv("DASHSCOPE_API_KEY") or os.getenv("GEMINI_API_KEY")):
        try:
            raw_segments, detected_language = build_raw_segments_aliyun(audio_file, split_config, file_url=args.file_url)
            if raw_segments:
                print("   ✅ 使用阿里云 ASR 识别完成。")
            else:
                print("   ⚠️ 阿里云 ASR 未识别到语音，回退至本地 Whisper")
                raw_segments, detected_language = build_raw_segments(
                    audio_file,
                    split_config=split_config,
                    force_english_rescue=args.force_english_rescue
                )
        except Exception as e:
            print(f"   ⚠️ 阿里云 ASR 识别失败，将回退至本地 Whisper: {e}")
            raw_segments, detected_language = build_raw_segments(
                audio_file,
                split_config=split_config,
                force_english_rescue=args.force_english_rescue
            )
    else:
        raw_segments, detected_language = build_raw_segments(
            audio_file,
            split_config=split_config,
            force_english_rescue=args.force_english_rescue
        )
    if detected_language:
        print(f"   -> Whisper 检测到源语言: {detected_language}")

    if not raw_segments:
        print("Whisper 未能识别出任何有效文本。")
        if args.reference_text_authority and reference_subtitles:
            raise ReferenceAuthorityAlignmentError("参考文本权威模式未获得 ASR 句段，拒绝使用参考字幕时间轴兜底")
        else:
            final_subtitles = []
    else:
        final_subtitles = build_raw_subtitles(raw_segments, detected_language)
        if args.reference_text_authority and reference_subtitles:
            print("   -> 正在按新 ASR 句段时间轴套用参考口播稿文本。")
            final_subtitles = build_reference_authority_subtitles(
                final_subtitles,
                reference_subtitles,
                split_config,
                source_language=detected_language,
                strict=True,
            )
        elif reference_subtitles:
            try:
                print("   -> 正在结合参考字幕与 ASR 时间轴进行对齐。")
                final_subtitles = align_subtitles_with_reference(final_subtitles, reference_subtitles, detected_language)
            except Exception as err:
                print(f"   ⚠️ 参考字幕对齐失败，继续使用 ASR 原始文本: {err}")
                if args.translate_subtitles:
                    try:
                        print("   -> 正在调用 LLM 补全中文字幕。")
                        final_subtitles = backfill_chinese_subtitles(final_subtitles, detected_language)
                    except Exception as err2:
                        print(f"   ⚠️ 中文字幕补全失败，继续使用 ASR 原始文本: {err2}")
        elif args.translate_subtitles:
            try:
                print("   -> 正在调用 LLM 补全中文字幕。")
                final_subtitles = backfill_chinese_subtitles(final_subtitles, detected_language)
            except Exception as err:
                print(f"   ⚠️ 中文字幕补全失败，继续使用 ASR 原始文本: {err}")
        else:
            print("   -> 跳过 LLM 字幕精修与翻译，直接使用 ASR 原始文本。")

    if reference_subtitles and final_subtitles and not args.reference_text_authority:
        final_subtitles = merge_reference_continuations(final_subtitles, reference_subtitles)

    if args.refine_subtitles and final_subtitles and not args.reference_text_authority:
        try:
            print("   -> 正在调用 LLM 精修字幕文本，保留 ASR 时间轴。")
            final_subtitles = refine_subtitles_with_llm(final_subtitles, detected_language)
        except Exception as err:
            print(f"   ⚠️ 大模型字幕精修失败，继续使用当前字幕: {err}")

    if reference_subtitles and final_subtitles and not args.reference_text_authority:
        final_subtitles = repair_subtitles_with_reference_terms(final_subtitles, reference_subtitles)
        final_subtitles = merge_reference_continuations(final_subtitles, reference_subtitles)

    if args.reference_text_authority:
        final_subtitles = normalize_final_subtitles(final_subtitles)
    else:
        final_subtitles = normalize_final_subtitles(normalize_subtitles_to_simplified(final_subtitles))
    director_data = [{"start": seg["time"][0], "end": seg["time"][1], "text": seg["text"]} for seg in final_subtitles]
    with open(audio_json_path, "w", encoding="utf-8") as f:
        json.dump(director_data, f, ensure_ascii=False, indent=2)

    with open(subtitles_json_path, "w", encoding="utf-8") as f:
        json.dump(final_subtitles, f, ensure_ascii=False, indent=2)

    speaker_scene = build_default_speaker_scene(final_subtitles)
    with open(speaker_scene_json_path, "w", encoding="utf-8") as f:
        json.dump(speaker_scene, f, ensure_ascii=False, indent=2)

    print(f"   ✅ {audio_json_path}、{subtitles_json_path} 与 {speaker_scene_json_path} 已生成！")
    if os.path.exists(audio_file):
        os.remove(audio_file)

    end_time = time.time()
    elapsed = round(end_time - start_time, 2)
    print(f"\n3. 大功告成！总耗时: {elapsed} 秒。")
    emit_result(
        "ASR 与字幕生成完成",
        audio_json=audio_json_path,
        subtitles_json=subtitles_json_path,
        speaker_scene_json=speaker_scene_json_path,
        segment_count=len(final_subtitles),
        elapsed_seconds=elapsed,
    )


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="ASR_FAILED",
        error_message="ASR 与字幕生成失败",
        error_stage="asr",
        hint="请检查输入视频、ASR 依赖和 FFmpeg",
    ))
