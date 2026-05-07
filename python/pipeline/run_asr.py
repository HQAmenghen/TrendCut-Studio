import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from faster_whisper import WhisperModel
import json
import time
import os
import subprocess
import argparse
import re
import uuid
from pathlib import Path
from urllib.parse import urlparse

import requests

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from llm_client import get_llm_provider
from script_protocol import emit_result, emit_stage, run_guarded

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


def sentence_text(sentence):
    text = str(sentence.get("text") or sentence.get("sentence") or sentence.get("sentence_text") or "").strip()
    if text:
        return apply_domain_corrections(text)
    words = sentence.get("words")
    if isinstance(words, list):
        joined = "".join(str(word.get("text") or word.get("word") or "") for word in words if isinstance(word, dict))
        return apply_domain_corrections(joined.strip())
    return ""


def parse_filetrans_result_segments(payload):
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
            raw_segments.append({
                "start": time_range[0],
                "end": time_range[1],
                "text": text
            })
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


def build_raw_segments_filetrans(file_url, model=None):
    model = model or get_qwen_asr_model()
    emit_stage("asr", "正在进行阿里云 Qwen3-ASR Filetrans 句级识别")
    print(f"1. 正在提交阿里云 {model} 文件转写任务...")
    task_id, headers = submit_qwen_filetrans_task(file_url, model)
    print(f"   -> Filetrans task_id: {task_id}")
    payload = wait_qwen_filetrans_task(task_id, headers)
    payload = expand_filetrans_transcription_urls(payload, headers=headers)
    raw_segments, detected_language = parse_filetrans_result_segments(payload)
    if not raw_segments:
        print("   ℹ️ Filetrans 调用成功但未解析到句级时间戳")
        return [], detected_language or "zh"

    print(f"   ✅ Filetrans 识别完成，语种: {detected_language}，句子数: {len(raw_segments)}")
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
            return build_raw_segments_filetrans(resolved_file_url, model=model)
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
    normalized = text or ""
    for wrong, right in sorted(DOMAIN_CORRECTIONS.items(), key=lambda item: len(item[0]), reverse=True):
        normalized = re.sub(re.escape(wrong), right, normalized, flags=re.IGNORECASE)
    normalized = normalized.replace("万事达卡卡", "万事达卡")
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
    return any(char in str(text or "") for char in "。！？!?；;，,、")


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
    text = apply_domain_corrections("".join(words).strip())
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


def split_segment_words(segment, split_config=None):
    split_config = resolve_split_config(split_config)
    words = list(getattr(segment, "words", None) or [])
    if not words:
        text = apply_domain_corrections(str(getattr(segment, "text", "")).strip())
        return [{
            "start": round(float(getattr(segment, "start", 0.0)), 2),
            "end": round(float(getattr(segment, "end", 0.0)), 2),
            "text": text
        }] if text else []

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
        sentence_break = contains_sentence_break(token)
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
    parser.add_argument("--max-chunk-duration", type=float, default=DEFAULT_SPLIT_CONFIG["max_chunk_duration"], help="Maximum subtitle chunk duration in seconds.")
    parser.add_argument("--soft-chunk-duration", type=float, default=DEFAULT_SPLIT_CONFIG["soft_chunk_duration"], help="Preferred subtitle chunk duration in seconds.")
    parser.add_argument("--max-visible-chars", type=int, default=DEFAULT_SPLIT_CONFIG["max_visible_chars"], help="Maximum visible characters before forcing a split.")
    parser.add_argument("--max-words-per-chunk", type=int, default=DEFAULT_SPLIT_CONFIG["max_words_per_chunk"], help="Maximum token count before forcing a split.")
    parser.add_argument("--pause-threshold", type=float, default=DEFAULT_SPLIT_CONFIG["pause_threshold"], help="Pause threshold in seconds for natural splits.")
    parser.add_argument("--force-english-rescue", action="store_true", help="Always run an extra English rescue transcription pass.")
    args = parser.parse_args()
    input_video = args.input
    audio_json_path = args.audio_json
    subtitles_json_path = args.subtitles_json
    speaker_scene_json_path = args.speaker_scene_json

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
        print("   -> 跳过 LLM 字幕精修与翻译，直接使用 ASR 原始文本。")
        final_subtitles = build_raw_subtitles(raw_segments, detected_language)

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
