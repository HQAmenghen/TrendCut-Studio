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
        repair_reference_subtitle_text,
        restore_preserved_terms,
        to_simplified_chinese,
    )
except ImportError:
    from pipeline.subtitle_terms import (
        extract_preserve_terms,
        mask_preserved_terms,
        repair_reference_subtitle_text,
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
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


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
    from qwen_client import get_qwen_api_keys

    api_key = get_qwen_api_keys()[0]
    base_url = get_qwen_asr_api_base_url()
    submit_url = f"{base_url}/services/audio/asr/transcription"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
    }
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
    response = requests.post(submit_url, headers=headers, json=payload, timeout=60)
    response.raise_for_status()
    result = response.json()
    task_id = ((result.get("output") or {}).get("task_id") or result.get("task_id") or "").strip()
    if not task_id:
        raise RuntimeError(f"Filetrans 未返回 task_id: {result}")
    return task_id, headers


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


def _call_aliyun_asr(dashscope_module, audio_path, model=None):
    messages = [
        {"role": "user", "content": [{"audio": audio_path}]}
    ]
    return dashscope_module.MultiModalConversation.call(
        api_key=dashscope_module.api_key,
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
    from qwen_client import get_qwen_api_keys
    dashscope.api_key = get_qwen_api_keys()[0]
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
            response = _call_aliyun_asr(dashscope, resolved_path, model=model)

            status_code = getattr(response, "status_code", None)
            if status_code != 200:
                print(f"   ⚠️ 阿里云 ASR 返回异常: status_code={status_code}, "
                      f"code={getattr(response, 'code', '?')}, message={getattr(response, 'message', '?')}")
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
        should_break = char in "。！？!?；;、" or (char in "，," and not is_numeric_separator(sample, index))
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
        subtitles[index]["zh"] = apply_domain_corrections(
            repair_reference_subtitle_text(restored_text, reference_text)
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

        preserve_terms = build_protected_terms(asr_text, reference_text, max_terms=12)
        protected_terms = build_protected_terms(asr_text, max_terms=8)
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
        reference_text = select_reference_context_for_asr(
            summarize_reference_context(reference_subtitles, start, end),
            current_text
        )
        if not reference_text:
            continue

        original_zh = str(entry.get("zh") or "").strip()
        if original_zh:
            repaired_zh = apply_domain_corrections(
                repair_reference_subtitle_text(original_zh, reference_text)
            )
            if repaired_zh != original_zh:
                entry["zh"] = repaired_zh
                entry["text"] = repaired_zh
                repaired_count += 1
                continue

        original_text = str(entry.get("text") or "").strip()
        if original_text:
            repaired_text = apply_domain_corrections(
                repair_reference_subtitle_text(original_text, reference_text)
            )
            if repaired_text != original_text:
                entry["text"] = repaired_text
                if not entry.get("zh"):
                    entry["zh"] = repaired_text
                repaired_count += 1

    if repaired_count:
        print(f"   ✅ 已按参考文本补齐关键数字字幕: {repaired_count} 条")
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
                subtitles[index]["zh"] = apply_domain_corrections(
                    restore_preserved_terms(zh_text, placeholders)
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
                subtitles[index]["zh"] = apply_domain_corrections(restored_text)
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
        final_subtitles = []
    else:
        final_subtitles = build_raw_subtitles(raw_segments, detected_language)
        if reference_subtitles:
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

    if reference_subtitles and final_subtitles:
        final_subtitles = merge_reference_continuations(final_subtitles, reference_subtitles)

    if args.refine_subtitles and final_subtitles:
        try:
            print("   -> 正在调用 LLM 精修字幕文本，保留 ASR 时间轴。")
            final_subtitles = refine_subtitles_with_llm(final_subtitles, detected_language)
        except Exception as err:
            print(f"   ⚠️ 大模型字幕精修失败，继续使用当前字幕: {err}")

    if reference_subtitles and final_subtitles:
        final_subtitles = repair_subtitles_with_reference_terms(final_subtitles, reference_subtitles)
        final_subtitles = merge_reference_continuations(final_subtitles, reference_subtitles)

    final_subtitles = normalize_subtitles_to_simplified(final_subtitles)
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
