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
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from llm_client import create_llm_client, generate_content, get_llm_provider
from script_protocol import emit_result, emit_stage, run_guarded

load_project_env(__file__)

DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"
DEFAULT_QWEN_MODEL = "qwen3.5-plus"

def get_text_model():
    """获取文本生成模型"""
    provider = get_llm_provider()
    if provider == "qwen":
        return os.getenv("QWEN_TEXT_MODEL", DEFAULT_QWEN_MODEL)
    else:
        return os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)

GEMINI_MODEL = get_text_model()
GLOSSARY_PATH = os.path.join(os.path.dirname(__file__), "glossary.json")

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


def is_supported_bilingual_subtitle(subtitle: dict) -> bool:
    zh_text = str(subtitle.get("zh", "")).strip()
    en_text = str(subtitle.get("en", "")).strip()
    return bool(zh_text and has_cjk(zh_text) and en_text and is_english_like(en_text))


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


def split_segment_words(segment):
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
        long_enough = duration >= 2.8
        too_long = duration >= 4.2 or visible_len >= 26
        enough_words = len(current_words) >= 10
        next_gap = (next_start - token_end) if next_start is not None else 0.0
        natural_pause = next_gap >= 0.42

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


def backfill_chinese_translations(raw_segments, normalized_subtitles):
    targets = []
    for index, subtitle in enumerate(normalized_subtitles):
        original_text = str(raw_segments[index]["text"]).strip()
        zh_text = str(subtitle.get("zh", "")).strip()
        if is_english_like(original_text) and not has_cjk(zh_text):
            targets.append({
                "index": index,
                "text": original_text
            })

    if not targets:
        return normalized_subtitles

    client = create_llm_client()
    payload = json.dumps(targets, ensure_ascii=False)
    prompt = f"""
你是一名专业字幕翻译，请把下面英文口播字幕翻译成简洁、自然、适合视频字幕展示的中文。

要求：
1. 保留数组中的 index 不变。
2. 每条只输出中文翻译，不要解释。
3. 翻译要完整，不要漏词，不要概括。
4. 用自然中文，不要保留英文在 zh 字段。
5. 严格输出 JSON 数组，不要输出 markdown。

输入：
{payload}

输出格式：
[
  {{
    "index": 0,
    "zh": "对应的中文字幕"
  }}
]
"""
    response = generate_content(
        client,
        model=GEMINI_MODEL,
        contents=prompt,
        response_mime_type="application/json",
    )
    result = json.loads(response.text)
    if not isinstance(result, list):
        return normalized_subtitles

    for item in result:
        try:
            idx = int(item.get("index"))
        except Exception:
            continue
        zh_text = apply_domain_corrections(str(item.get("zh", "")).strip())
        if 0 <= idx < len(normalized_subtitles) and zh_text and has_cjk(zh_text):
            normalized_subtitles[idx]["zh"] = zh_text

    return normalized_subtitles


def backfill_bilingual_translations(raw_segments, normalized_subtitles, source_language=""):
    targets = []
    for index, subtitle in enumerate(normalized_subtitles):
        if is_supported_bilingual_subtitle(subtitle):
            continue
        original_text = str(raw_segments[index]["text"]).strip()
        if not original_text:
            continue
        targets.append({
            "index": index,
            "text": original_text
        })

    if not targets:
        return normalized_subtitles

    client = create_llm_client()
    payload = json.dumps(targets, ensure_ascii=False)
    prompt = f"""
你是一名专业字幕翻译，请把下面原始字幕统一补齐为中英双语字幕。

源语言提示：{source_language or "unknown"}

要求：
1. 保留数组中的 index 不变。
2. 无论原始语言是什么，zh 必须是自然、完整的简体中文字幕。
3. 无论原始语言是什么，en 必须是自然、完整的英文字幕。
4. 严禁把日文、韩文、阿拉伯文、俄文等原文直接写进 zh 字段。
5. 严禁把除英文外的原文直接写进 en 字段。
6. 严格输出 JSON 数组，不要输出 markdown。

输入：
{payload}

输出格式：
[
  {{
    "index": 0,
    "zh": "对应的中文字幕",
    "en": "Corresponding English subtitle"
  }}
]
"""
    response = generate_content(
        client,
        model=GEMINI_MODEL,
        contents=prompt,
        response_mime_type="application/json",
    )
    result = json.loads(response.text)
    if not isinstance(result, list):
        return normalized_subtitles

    for item in result:
        try:
            idx = int(item.get("index"))
        except Exception:
            continue
        if not (0 <= idx < len(normalized_subtitles)):
            continue
        zh_text = apply_domain_corrections(str(item.get("zh", "")).strip())
        en_text = str(item.get("en", "")).strip()
        if zh_text and has_cjk(zh_text):
            normalized_subtitles[idx]["zh"] = zh_text
        if en_text and is_english_like(en_text):
            normalized_subtitles[idx]["en"] = en_text

    return normalized_subtitles


def load_optional_visual_context():
    result_path = Path("result.json")
    if not result_path.exists():
        return None
    try:
        payload = json.loads(result_path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


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


def analyze_speaker_scene(subtitles, visual_context):
    fallback = build_default_speaker_scene(subtitles)
    if not subtitles:
        return fallback

    client = create_llm_client()
    subtitle_payload = json.dumps(subtitles, ensure_ascii=False)
    visual_payload = json.dumps(visual_context or {}, ensure_ascii=False)
    prompt = f"""
你是一名短视频导播分析师。请根据字幕时间轴和可选视觉轴，输出一份供 AI 导演使用的人物关系与 9:16 取景分析 JSON。

输入一：
字幕时间轴（subtitles）
{subtitle_payload}

输入二：
视觉轴（visual_context，可为空）
{visual_payload}

你的任务：
1. 判断这段视频大约有几位主要参与者（participant_count）。
2. 给出参与者关系摘要，例如”主播 + 嘉宾””主持人 + 两位连线嘉宾””单人解说””多人圆桌讨论”。
3. 为每个参与者生成稳定 ID，例如 speaker_1 / speaker_2。
4. 结合字幕和视觉轴，给出时间线级别的主讲人与竖屏取景建议。
5. 如果视觉轴明确提到人物位置或多人分屏，请据此决定：
   a. crop_anchor（粗粒度）：left / center / right
   b. crop_x_ratio（精细位置，0.0~1.0 浮点数，**必填**）：
      - 人物在画面左 1/3 → 0.2~0.3
      - 人物在画面左半 → 0.3~0.45
      - 居中或不确定 → 0.5
      - 人物在画面右半 → 0.55~0.7
      - 人物在画面右 1/3 → 0.7~0.8
      - 多人/图表/PPT 需保留全局信息 → 0.5
      - 请根据视觉轴的实际描述认真估算，不要全部填 0.5。
6. vertical_mode 仅允许：
   - follow_speaker
   - center_safe
   - preserve_context
7. shot_type 仅允许：
   - single
   - two_shot
   - group
   - graphic
8. 不要编造过细的事实；不确定时保持保守，优先 center_safe。
9. timeline 尽量覆盖字幕时间轴中的主要段落，但不要求逐字逐句一一对应。
10. 严格输出 JSON 对象，不要输出 markdown。

输出格式：
{{
  “participant_count”: 2,
  “relationship_summary”: “主持人和嘉宾对谈”,
  “participants”: [
    {{
      “speaker_id”: “speaker_1”,
      “label”: “主持人”,
      “role”: “提问者/主持”,
      “visual_hint”: “left”,
      “confidence”: 0.82
    }}
  ],
  “timeline”: [
    {{
      “start”: 0.0,
      “end”: 5.2,
      “active_speakers”: [“speaker_1”],
      “speaker_count”: 1,
      “relationship_hint”: “主持人开场”,
      “focus_target”: “speaker_1”,
      “shot_type”: “single”,
      “vertical_mode”: “follow_speaker”,
      “crop_anchor”: “left”,
      “crop_x_ratio”: 0.28,
      “reason”: “主持人发言，视觉轴描述其在画面左侧约 1/4 处，crop_x_ratio 取 0.28。”
    }}
  ],
  “global_guidance”: {{
    “default_vertical_mode”: “center_safe”,
    “default_crop_anchor”: “center”,
    “default_crop_x_ratio”: 0.5,
    “notes”: [“补充说明”]
  }}
}}
"""
    try:
        response = generate_content(
            client,
            model=GEMINI_MODEL,
            contents=prompt,
            response_mime_type="application/json",
        )
        result = json.loads(response.text)
        if not isinstance(result, dict):
            return fallback
        if not isinstance(result.get("timeline"), list) or not result.get("timeline"):
            result["timeline"] = fallback["timeline"]
        if not isinstance(result.get("participants"), list) or not result.get("participants"):
            result["participants"] = fallback["participants"]
        if not result.get("participant_count"):
            result["participant_count"] = max(1, len(result["participants"]))
        if not result.get("relationship_summary"):
            result["relationship_summary"] = fallback["relationship_summary"]
        if not isinstance(result.get("global_guidance"), dict):
            result["global_guidance"] = fallback["global_guidance"]
        return result
    except Exception as err:
        print(f"   ⚠️ 人物关系分析失败，回退默认单人方案: {err}")
        return fallback


def refine_and_translate(raw_segments, source_language=""):
    client = create_llm_client()
    payload = json.dumps(raw_segments, ensure_ascii=False)
    prompt = f"""
你是一名顶级加密货币与金融科技领域字幕校对师和专业双语译者。下面是一段短视频口播经过 Whisper 打轴后的初稿，
时间轴基本可信，但文本中可能存在同音错字、专有名词错误、断句不当、标点缺失、口语冗余等问题。

源语言提示：{source_language or "unknown"}

你的任务：
1. 严格保留数组条数不变，绝对不得合并、拆分、删除或新增条目。
2. 严格保留每一条的 start 和 end 原值，绝对不要改时间轴。
3. 最终必须输出标准 JSON 数组，每条字幕包含：
   - time: 保持原有时间数组语义不变
   - zh: 简体中文字幕
   - en: 自然流畅的英文字幕
4. zh 与 en 必须逐条一一对应，断句边界尽量一致，不得跨条错位。
5. 输出必须是纯 JSON 数组，不要包含 markdown、代码块或任何额外说明。

中文处理原则（zh）：
1. 中文必须流畅、自然、适合短视频字幕展示。
2. 优先保证语义完整，不得漏词、吞词、随意省略助词。
3. 允许轻微口语化润色，让表达更顺、更有节奏感。
4. 可以有轻微网感或轻微幽默感，但仅限措辞层面，严禁改变原意、添加新信息、加入评论腔或过度玩梗。
5. 如果原句本身严肃，就保持专业，不要强行幽默。
6. 加密/金融科技专有名词必须准确：
   - “万事打卡”“万事达卡” -> 万事达卡
   - “维萨/威萨” -> Visa
   - “彭国社/彭博社” -> 彭博社
   - “稳定必/稳定比/稳定币” -> 稳定币
   - “加密权/加密圈” -> 加密圈（根据语境判断）
   - “比特比” -> 比特币
   - “以太防” -> 以太坊
   - “SEC” 保持英文
   - “Clarity Act”“Genius Act” 等法案名保持原英文，必要时可补充极简中文说明

英文处理原则（en）：
1. 提供自然、简洁、专业、适合国际观众的英文字幕。
2. 修正语法，去掉无意义口头禅和冗余，但保留原意和语气。
3. 专有名词必须准确，例如 Bitcoin、Ethereum、Mastercard、Visa、SEC、stablecoin。
4. 不要写得像书面论文，要像真实视频字幕。

其他要求：
1. 不要扩写，不要总结，不要添加解释或旁白。
2. 字幕要适合短视频展示：简洁、有力、节奏清楚。
3. 如果某条很短，只做必要纠错和润色。
4. 如果原始语言是中文，zh 以校对润色为主，en 负责准确翻译。
5. 如果原始语言是英文，en 以校对润色为主，zh 负责自然中文翻译。
6. 如果原始语言既不是中文也不是英文，zh 和 en 都必须分别翻译，严禁把原文直接塞进 zh 或 en。

输入 JSON：
{payload}

输出 JSON 结构必须为：
[
  {{
    "time": [0.0, 1.2],
    "zh": "修正后的中文字幕",
    "en": "Natural English subtitle"
  }}
]
"""
    response = generate_content(
        client,
        model=GEMINI_MODEL,
        contents=prompt,
        response_mime_type="application/json",
    )
    result = json.loads(response.text)
    if not isinstance(result, list) or len(result) != len(raw_segments):
        raise ValueError("Gemini returned invalid subtitle structure.")

    normalized = []
    for index, item in enumerate(result):
        original = raw_segments[index]
        original_text = apply_domain_corrections(str(original["text"]).strip())
        zh_text = apply_domain_corrections(str(item.get("zh", "")).strip() or original_text)
        en_text = str(item.get("en", "")).strip()

        original_visible = visible_text(original_text)
        zh_visible = visible_text(zh_text)

        # 仅中文原语种需要执行中文保真回退；其他语种必须保持 zh 为中文翻译
        if is_chinese_language(source_language) and zh_visible:
            too_short = len(zh_visible) < len(original_visible)
            ratio_bad = len(original_visible) > 0 and (len(zh_visible) / len(original_visible)) < 0.95
            if too_short or ratio_bad:
                zh_text = original_text

        if is_english_language(source_language) and not en_text and original_text:
            en_text = original_text

        normalized.append({
            "time": [original["start"], original["end"]],
            "zh": zh_text,
            "en": en_text
        })
    if is_english_language(source_language):
        normalized = backfill_chinese_translations(raw_segments, normalized)
    else:
        normalized = backfill_bilingual_translations(raw_segments, normalized, source_language)
    return normalized


def transcribe_raw_segments(model, audio_file, language=None, stage_label="auto"):
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
        sub_segments = split_segment_words(segment)
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


def build_raw_segments(audio_file):
    emit_stage("asr", "正在进行 Whisper ASR 识别")
    print("1. 正在加载 Whisper 模型进行 ASR 识别...")
    model = WhisperModel("small", device="cpu", compute_type="int8")

    print("2. Whisper 模型加载完毕！开始识别语音...")
    raw_segments, detected_language = transcribe_raw_segments(model, audio_file, language=None, stage_label="auto")

    # 对“中文主语种但夹杂英文口播”的视频，补做一次英文转写，把主识别漏掉的英语时间段补回来。
    if is_chinese_language(detected_language):
        try:
            english_segments, _ = transcribe_raw_segments(model, audio_file, language="en", stage_label="en-rescue")
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
    parser.add_argument("--allow-no-audio", action="store_true", help="Allow silent videos and generate empty subtitle files instead of failing.")
    parser.add_argument("--audio-json", default="audio.json", help="Output audio timeline JSON file.")
    parser.add_argument("--subtitles-json", default="subtitles.json", help="Output subtitles JSON file.")
    parser.add_argument("--speaker-scene-json", default="speaker_scene.json", help="Output speaker/scene JSON file.")
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
    raw_segments, detected_language = build_raw_segments(audio_file)
    if detected_language:
        print(f"   -> Whisper 检测到源语言: {detected_language}")

    if not raw_segments:
        print("Whisper 未能识别出任何有效文本。")
        final_subtitles = []
    else:
        try:
            print("   -> 正在调用 Gemini 对 ASR 结果进行纠错、润色并生成英文翻译...")
            final_subtitles = refine_and_translate(raw_segments, detected_language)
            print("   ✅ 双语字幕精修完成！")
        except Exception as err:
            print(f"   ⚠️ Gemini 精修失败，回退为原始 ASR 文本: {err}")
            final_subtitles = []
            for s in raw_segments:
                original_text = str(s["text"]).strip()
                fallback_zh = original_text if is_chinese_language(detected_language) else ""
                fallback_en = original_text if is_english_language(detected_language) else ""
                final_subtitles.append({
                    "time": [s["start"], s["end"]],
                    "zh": fallback_zh,
                    "en": fallback_en
                })
            try:
                print("   -> 正在尝试补齐中英双语字幕...")
                if is_english_language(detected_language):
                    final_subtitles = backfill_chinese_translations(raw_segments, final_subtitles)
                    final_subtitles = backfill_bilingual_translations(raw_segments, final_subtitles, detected_language)
                else:
                    final_subtitles = backfill_bilingual_translations(raw_segments, final_subtitles, detected_language)
                print("   ✅ 已补齐可恢复的中英双语字幕。")
            except Exception as translation_err:
                print(f"   ⚠️ 中英字幕补翻失败，保留当前可用文本: {translation_err}")

    director_data = [{"start": seg["time"][0], "end": seg["time"][1], "text": seg["zh"]} for seg in final_subtitles]
    with open(audio_json_path, "w", encoding="utf-8") as f:
        json.dump(director_data, f, ensure_ascii=False, indent=2)

    with open(subtitles_json_path, "w", encoding="utf-8") as f:
        json.dump(final_subtitles, f, ensure_ascii=False, indent=2)

    visual_context = load_optional_visual_context()
    speaker_scene = analyze_speaker_scene(final_subtitles, visual_context)
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
        hint="请检查输入视频、Whisper 依赖、FFmpeg 和 Gemini Key",
    ))
