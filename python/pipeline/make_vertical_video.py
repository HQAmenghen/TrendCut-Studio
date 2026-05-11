import json
import subprocess
import sys
from pathlib import Path
import argparse
from PIL import Image, ImageDraw, ImageFont
import re
import os

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from script_protocol import emit_error, emit_result, emit_stage
from llm_client import create_llm_client, generate_content, get_text_llm_provider
from skills.prompt_skill_loader import load_prompt_text
try:
    from subtitle_terms import mask_preserved_terms, restore_preserved_terms, to_simplified_chinese
except ImportError:
    from pipeline.subtitle_terms import mask_preserved_terms, restore_preserved_terms, to_simplified_chinese

# 终极防崩溃补丁
sys.stdout.reconfigure(encoding='utf-8')

# ================== Hardcoded Configs ==================
WIDTH = 1080
HEIGHT = 1920
TITLE_BOX = (84, 108, 960, 430)
SUBTITLE_CARD_SIZE = (1080, 600)  # Increased from 360 to 600 to prevent dual-language clipping
VIDEO_FRAME_WIDTH = 1080
VIDEO_FRAME_HEIGHT = 810
VIDEO_FRAME_Y = 470
SUBTITLE_OVERLAY_Y = 1315  # Adjusted from 1310/1250 to avoid overlapping with video frame (470+810=1280)
DEFAULT_SUBTITLE_OFFSET_Y = 10
SUBTITLE_GAP_SECONDS = 0.08
TITLE_FONTS = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
]
ZH_FONTS = TITLE_FONTS
EN_FONTS = [
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
]
DEFAULT_TITLE_FONT_SIZE = 104
DEFAULT_TITLE_MIN_SIZE = 60
DEFAULT_TITLE_MAX_LINES = 2
DEFAULT_ZH_FONT_SIZE = 50
DEFAULT_ZH_MIN_SIZE = 16
DEFAULT_ZH_MAX_LINES = 3
DEFAULT_EN_FONT_SIZE = 52
DEFAULT_EN_MIN_SIZE = 16
DEFAULT_EN_MAX_LINES = 3

# ================== Helper Functions ==================
def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def normalize_subtitles_for_display(subtitles: list[dict]) -> list[dict]:
    if not isinstance(subtitles, list):
        return []

    normalized = []
    for entry in subtitles:
        if not isinstance(entry, dict):
            continue
        item = dict(entry)
        for key in ("zh", "text", "en"):
            if item.get(key):
                item[key] = to_simplified_chinese(str(item[key]).strip())
        normalized.append(item)
    return normalized


def probe_media(input_video: Path) -> dict:
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration:stream=duration,codec_type",
        "-of", "json",
        str(input_video)
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", check=True)
    payload = json.loads(result.stdout or "{}")
    streams = payload.get("streams") or []
    
    # 优先使用 format 层的 duration，如果不存在则遍历 streams
    duration_str = (payload.get("format") or {}).get("duration")
    if not duration_str or duration_str == "N/A":
        for s in streams:
            if s.get("duration") and s.get("duration") != "N/A":
                duration_str = s.get("duration")
                break
    
    duration = float(duration_str or 0.0)
    has_audio = any(str(stream.get("codec_type") or "") == "audio" for stream in streams)
    return {
        "duration": max(0.0, duration),
        "has_audio": has_audio
    }

def resolve_font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont:
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(str(candidate), size=size)
    raise FileNotFoundError(f"Font not found. Tried: {candidates}")

def text_bbox(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, **kwargs):
    align = kwargs.pop("align", "center")
    return draw.multiline_textbbox((0, 0), text, font=font, **kwargs, align=align)

def tokenize_text_units(text: str) -> list[str]:
    tokens = re.findall(r"[A-Za-z0-9%$#@&+\-_/.:]+|\s+|.", text)
    return tokens or [text]

def fit_single_line(text: str, font: ImageFont.FreeTypeFont, max_width: int, **kwargs) -> str:
    stripped = text.strip()
    if not stripped:
        return ""
    bbox_kwargs = kwargs.copy()
    bbox_kwargs.pop("spacing", None)
    if font.getbbox(stripped, **bbox_kwargs)[2] <= max_width:
        return stripped

    suffix = "..."
    tokens = tokenize_text_units(stripped)
    safe_tokens: list[str] = []

    for token in tokens:
        candidate = "".join(safe_tokens + [token]).strip()
        preview = candidate + suffix
        if candidate and font.getbbox(preview, **bbox_kwargs)[2] <= max_width:
            safe_tokens.append(token)
            continue

        normalized_token = token.strip()
        if not safe_tokens and normalized_token:
            chars = list(normalized_token)
            safe_chars: list[str] = []
            while chars:
                candidate_chars = "".join(safe_chars + [chars[0]]).strip()
                preview_chars = candidate_chars + suffix
                if candidate_chars and font.getbbox(preview_chars, **bbox_kwargs)[2] <= max_width:
                    safe_chars.append(chars.pop(0))
                else:
                    break
            return ("".join(safe_chars).strip() or normalized_token[:1]) + suffix
        break

    while safe_tokens:
        candidate = "".join(safe_tokens).strip()
        preview = candidate + suffix
        if font.getbbox(preview, **bbox_kwargs)[2] <= max_width:
            return preview
        safe_tokens.pop()
    return suffix

def is_orphan_punctuation(text: str) -> bool:
    stripped = text.strip()
    return bool(stripped) and bool(re.fullmatch(r"[，。！？；：、,.!?;:]+", stripped))

def visible_text_len(text: str) -> int:
    stripped = re.sub(r"\s+", "", text or "").strip()
    stripped = re.sub(r"[，。！？；：、,.!?;:]+", "", stripped)
    return len(stripped)

def line_visual_width(font: ImageFont.FreeTypeFont, text: str, **kwargs) -> int:
    bbox_kwargs = kwargs.copy()
    bbox_kwargs.pop("spacing", None)
    return font.getbbox(text.strip(), **bbox_kwargs)[2] if text.strip() else 0

def score_line_split(first: str, second: str, font: ImageFont.FreeTypeFont, max_width: int, **kwargs) -> float:
    if not first.strip() or not second.strip():
        return float("inf")
    if is_orphan_punctuation(second):
        return float("inf")
    if re.match(r"^[，。！？；：、,.!?;:]+", second.strip()):
        return float("inf")

    first_width = line_visual_width(font, first, **kwargs)
    second_width = line_visual_width(font, second, **kwargs)
    if first_width > max_width or second_width > max_width:
        return float("inf")

    desired_first_ratio = 0.52
    desired_second_ratio = 0.9
    first_ratio = first_width / max_width if max_width else 1
    second_ratio = second_width / max_width if max_width else 1
    hierarchy_penalty = abs(first_ratio - desired_first_ratio) * 1200 + abs(second_ratio - desired_second_ratio) * 1000
    if first_width >= second_width:
        hierarchy_penalty += 1200
    if second_width - first_width < max_width * 0.12:
        hierarchy_penalty += 600
    short_tail_penalty = 0
    if visible_text_len(second) <= 3:
        short_tail_penalty += 1000
    if visible_text_len(first) <= 3:
        short_tail_penalty += 1000

    english_break_penalty = 0
    if re.search(r"[A-Za-z0-9]$", first) and re.search(r"^[A-Za-z0-9]", second):
        english_break_penalty += 1500

    return hierarchy_penalty + short_tail_penalty + english_break_penalty

def rebalance_two_lines(lines: list[str], font: ImageFont.FreeTypeFont, max_width: int, **kwargs) -> list[str]:
    compact = "".join(line.strip() for line in lines if line.strip())
    if not compact:
        return lines

    # Preserve whitespace tokens so English words do not collapse together when
    # we rebalance a two-line subtitle block.
    tokens = tokenize_text_units(compact)
    if len(tokens) < 2:
        return lines

    best_pair = None
    best_score = float("inf")
    for index in range(1, len(tokens)):
        if not "".join(tokens[:index]).strip() or not "".join(tokens[index:]).strip():
            continue
        first = "".join(tokens[:index]).strip()
        second = "".join(tokens[index:]).strip()
        score = score_line_split(first, second, font, max_width, **kwargs)
        if score < best_score:
            best_score = score
            best_pair = [first, second]

    return best_pair or lines

def normalize_wrapped_lines(lines: list[str], font: ImageFont.FreeTypeFont, max_width: int, **kwargs) -> list[str]:
    bbox_kwargs = kwargs.copy()
    bbox_kwargs.pop("spacing", None)
    normalized: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if normalized and is_orphan_punctuation(stripped):
            merged = normalized[-1] + stripped
            if font.getbbox(merged, **bbox_kwargs)[2] <= max_width:
                normalized[-1] = merged
                continue
            normalized.append(stripped)
            continue
        normalized.append(stripped)

    if len(normalized) >= 2:
        last = normalized[-1]
        prev = normalized[-2]
        if visible_text_len(last) <= 2:
            merged = prev + last
            if font.getbbox(merged, **bbox_kwargs)[2] <= max_width:
                normalized[-2] = merged
                normalized.pop()
            else:
                candidate = fit_single_line(merged, font, max_width, **bbox_kwargs)
                if "..." not in candidate and visible_text_len(candidate) >= visible_text_len(prev):
                    normalized[-2] = candidate
                    normalized.pop()

    if len(normalized) == 2:
        normalized = rebalance_two_lines(normalized, font, max_width, **bbox_kwargs)
    return normalized

def wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int, max_lines: int | None = None, **kwargs) -> str:
    bbox_kwargs = kwargs.copy()
    bbox_kwargs.pop('spacing', None)

    wrapped_lines = []
    for raw_line in text.split('\n'):
        line = raw_line.strip()
        if not line:
            if wrapped_lines:
                wrapped_lines.append("")
            continue

        current_line = ""
        for token in tokenize_text_units(line):
            candidate = token if not current_line else current_line + token
            if font.getbbox(candidate, **bbox_kwargs)[2] <= max_width:
                current_line = candidate
            else:
                if current_line:
                    wrapped_lines.append(current_line.strip())
                    if max_lines and len(wrapped_lines) >= max_lines:
                        wrapped_lines[-1] = fit_single_line(wrapped_lines[-1], font, max_width, **bbox_kwargs)
                        wrapped_lines = normalize_wrapped_lines(wrapped_lines[:max_lines], font, max_width, **bbox_kwargs)
                        return '\n'.join(wrapped_lines)
                    current_line = token.strip()
                else:
                    current_line = fit_single_line(token.strip(), font, max_width, **bbox_kwargs)
        if current_line:
            wrapped_lines.append(current_line.strip())
            if max_lines and len(wrapped_lines) >= max_lines:
                wrapped_lines[-1] = fit_single_line(wrapped_lines[-1], font, max_width, **bbox_kwargs)
                wrapped_lines = normalize_wrapped_lines(wrapped_lines[:max_lines], font, max_width, **bbox_kwargs)
                return '\n'.join(wrapped_lines)

    if max_lines and len(wrapped_lines) > max_lines:
        wrapped_lines = wrapped_lines[:max_lines]
        wrapped_lines[-1] = fit_single_line(wrapped_lines[-1], font, max_width, **bbox_kwargs)
    wrapped_lines = normalize_wrapped_lines(wrapped_lines, font, max_width, **bbox_kwargs)
    return '\n'.join(wrapped_lines)

def fit_text(draw: ImageDraw.ImageDraw, text: str, font_candidates: list[str], start_size: int, min_size: int, max_width: int, max_height: int, max_lines: int | None = None, **kwargs) -> tuple[ImageFont.FreeTypeFont, str]:
    for size in range(start_size, min_size - 1, -2):
        font = resolve_font(font_candidates, size)
        wrapped = wrap_text(draw, text, font, max_width, max_lines=max_lines, **kwargs)
        bbox = text_bbox(draw, wrapped, font, **kwargs)
        line_count = len([line for line in wrapped.split('\n') if line.strip()]) or 1
        if (bbox[2] - bbox[0] <= max_width) and (bbox[3] - bbox[1] <= max_height) and (max_lines is None or line_count <= max_lines):
            return font, wrapped
    return font, wrapped


def fit_text_adaptive(draw: ImageDraw.ImageDraw, text: str, font_candidates: list[str], start_size: int, min_size: int, max_width: int, max_height: int, max_lines: int | None = None, relax_max_lines: int | None = None, **kwargs) -> tuple[ImageFont.FreeTypeFont, str]:
    font, wrapped = fit_text(
        draw,
        text,
        font_candidates,
        start_size,
        min_size,
        max_width,
        max_height,
        max_lines=max_lines,
        **kwargs
    )

    # 如果当前排版已经出现省略，尝试放宽一行，优先保证完整显示。
    if "..." not in wrapped or not relax_max_lines or not max_lines or relax_max_lines <= max_lines:
        return font, wrapped

    relaxed_font, relaxed_wrapped = fit_text(
        draw,
        text,
        font_candidates,
        start_size,
        min_size,
        max_width,
        max_height,
        max_lines=relax_max_lines,
        **kwargs
    )

    if "..." not in relaxed_wrapped:
        return relaxed_font, relaxed_wrapped
    return font, wrapped

def fit_title_text(draw: ImageDraw.ImageDraw, text: str, font_candidates: list[str], start_size: int, min_size: int, max_width: int, max_height: int, max_lines: int | None = None, **kwargs) -> tuple[ImageFont.FreeTypeFont, str]:
    explicit_lines = [line.strip() for line in str(text or "").splitlines() if line.strip()]
    if len(explicit_lines) >= 2:
        joined = "\n".join(explicit_lines[:max_lines] if max_lines else explicit_lines)
        for size in range(start_size, min_size - 1, -2):
            font = resolve_font(font_candidates, size)
            bbox = text_bbox(draw, joined, font, **kwargs)
            line_widths = [line_visual_width(font, line, **kwargs) for line in explicit_lines]
            line_count = len(explicit_lines)
            if (
                all(width <= max_width for width in line_widths)
                and (bbox[2] - bbox[0] <= max_width)
                and (bbox[3] - bbox[1] <= max_height)
                and (max_lines is None or line_count <= max_lines)
            ):
                return font, joined
    return fit_text(draw, text, font_candidates, start_size, min_size, max_width, max_height, max_lines=max_lines, **kwargs)

def make_background(content: dict, output_path: Path, title_font_size: int, title_min_size: int, title_max_lines: int):
    # Simplified background generation
    image = Image.new("RGB", (WIDTH, HEIGHT), "#0E5FB5")
    draw = ImageDraw.Draw(image)
    if "title" in content and content["title"]:
        title_font, title_text = fit_title_text(
            draw,
            content["title"],
            TITLE_FONTS,
            title_font_size,
            title_min_size,
            TITLE_BOX[2] - TITLE_BOX[0],
            TITLE_BOX[3] - TITLE_BOX[1],
            max_lines=title_max_lines,
            stroke_width=12,
            spacing=6
        )
        title_bbox = text_bbox(draw, title_text, title_font, stroke_width=12, spacing=6, align="left")
        title_pos = (
            TITLE_BOX[0],
            TITLE_BOX[1] + ((TITLE_BOX[3] - TITLE_BOX[1]) - (title_bbox[3] - title_bbox[1])) / 2
        )
        draw.multiline_text(
            title_pos,
            title_text,
            font=title_font,
            fill="#FFD400",
            align="left",
            spacing=6,
            stroke_width=12,
            stroke_fill="black"
        )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, quality=95)

def translate_subtitles_batch(subtitles: list[dict]):
    subtitles = normalize_subtitles_for_display(subtitles)
    targets = []
    for i, entry in enumerate(subtitles):
        zh_text = entry.get("zh", entry.get("text", "")).strip()
        en_text = entry.get("en", "").strip()
        if zh_text and not en_text:
            masked_text, placeholders = mask_preserved_terms(zh_text)
            targets.append({
                "index": i,
                "text": masked_text,
                "placeholders": placeholders,
                "source_text": zh_text
            })
    
    if not targets:
        return subtitles
    
    emit_stage("vertical_translate", f"正在自动补全 {len(targets)} 条英文翻译")
    print(f"INFO: Detected {len(targets)} entries missing English. Translating via LLM...")
    
    try:
        provider = get_text_llm_provider()
        client = create_llm_client(provider=provider)
        # 加载用户自定义的翻译优化建议提示词 (与 run_asr.py 保持一致)
        # 强制补充 index 要求，否则 Refine Translate Prompt 默认不返回 index 导致映射失败
        base_prompt = load_prompt_text("run_asr_skill.md", "Refine Translate Prompt")
        custom_instructions = "\n\nCRITICAL: You MUST include the original 'index' (int) field in your output for each object so I can map them back."
        custom_instructions += "\nPreserve any [[TERM_n]] placeholders exactly as they appear; restore them to the original English names, tickers, acronyms, or numbers in the final English subtitle."
        prompt = (base_prompt + custom_instructions).format(
            source_language="zh", 
            payload=json.dumps(targets, ensure_ascii=False)
        )
        
        if provider == "deepseek":
            model_name = os.getenv("DEEPSEEK_TEXT_MODEL", "deepseek-v4-pro")
        elif provider in ("gemini", "vertex"):
            model_name = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
        else:
            model_name = os.getenv("QWEN_TEXT_MODEL", "qwen-max")
        
        response = generate_content(
            client,
            model=model_name,
            contents=prompt,
            response_mime_type="application/json",
            provider=provider
        )
        
        results = json.loads(response.text)
        target_lookup = {item["index"]: item for item in targets if isinstance(item, dict) and "index" in item}
        if isinstance(results, list):
            for res in results:
                try:
                    idx = int(res.get("index"))
                except (TypeError, ValueError):
                    continue
                en = res.get("en")
                if 0 <= idx < len(subtitles) and en:
                    placeholders = target_lookup.get(idx, {}).get("placeholders") or {}
                    restored_en = restore_preserved_terms(str(en).strip(), placeholders)
                    subtitles[idx]["en"] = restored_en
            print(f"   ✅ Successfully translated {len(results)} items.")
    except Exception as e:
        print(f"   ⚠️ Auto-translation failed: {e}")
    
    return subtitles


def is_numeric_separator(text: str, index: int) -> bool:
    if not (0 <= index < len(text)):
        return False
    if text[index] not in ".,，":
        return False
    previous_char = text[index - 1] if index > 0 else ""
    next_char = text[index + 1] if index + 1 < len(text) else ""
    return previous_char.isdigit() and next_char.isdigit()


def split_subtitle_text_chunks(text: str, min_visible_chars: int = 4) -> list[str]:
    sample = str(text or "").strip()
    if not sample:
        return []

    chunks = []
    current = ""
    for index, char in enumerate(sample):
        current += char
        is_break = char in "。！？；：、" or (char in "，," and not is_numeric_separator(sample, index))
        if is_break:
            chunk = current.strip()
            if chunk:
                chunks.append(chunk)
            current = ""
    if current.strip():
        chunks.append(current.strip())

    compacted = []
    for chunk in chunks:
        if compacted and visible_text_len(chunk) < min_visible_chars:
            compacted[-1] = f"{compacted[-1]}{chunk}"
        else:
            compacted.append(chunk)
    return compacted


def split_long_subtitles(subtitles: list[dict], max_chars: int = 32):
    new_subs = []
    for entry in subtitles:
        entry = normalize_subtitles_for_display([entry])[0] if isinstance(entry, dict) else entry
        zh = entry.get("zh", entry.get("text", "")).strip()
        en = entry.get("en", "").strip()
        time_range = entry.get("time")
        if not time_range or len(time_range) < 2 or not zh:
            new_subs.append(entry)
            continue
            
        start, end = float(time_range[0]), float(time_range[1])
        duration = end - start
        
        if len(zh) > max_chars and duration > 2.5:
            chunks = split_subtitle_text_chunks(zh)
            if len(chunks) <= 1:
                new_subs.append(entry)
                continue

            total_chars = sum(len(c) for c in chunks)
            print(f"   -> Splitting long segment: '{zh[:10]}...' into {len(chunks)} fragments with weighted timing.")
            en_words = en.split()

            accumulated_time = start
            for i, chunk_zh in enumerate(chunks):
                ratio = len(chunk_zh) / total_chars if total_chars > 0 else 1.0 / len(chunks)
                c_duration = duration * ratio
                c_start = accumulated_time
                c_end = c_start + c_duration
                accumulated_time = c_end

                chunk_en = ""
                if en_words:
                    word_start_idx = int((sum(len(chunks[j]) for j in range(i)) / total_chars) * len(en_words)) if total_chars > 0 else 0
                    word_end_idx = int((sum(len(chunks[j]) for j in range(i + 1)) / total_chars) * len(en_words)) if total_chars > 0 else len(en_words)
                    if i == len(chunks) - 1:
                        word_end_idx = len(en_words)
                    chunk_en = " ".join(en_words[word_start_idx:word_end_idx])

                new_subs.append({
                    "time": [round(c_start, 3), round(c_end, 3)],
                    "zh": chunk_zh,
                    "en": chunk_en or en
                })
            continue

        new_subs.append(entry)
    return new_subs


def deduplicate_subtitles(subtitles: list[dict]):
    if not subtitles: return []
    subtitles.sort(key=lambda x: x["time"][0])
    
    unique = []
    current = subtitles[0]
    for i in range(1, len(subtitles)):
        next_sub = subtitles[i]
        # 如果文本相同且时间重叠或极度接近，则强力合并
        if next_sub.get("zh") == current.get("zh") and next_sub["time"][0] <= current["time"][1] + 0.15:
            current["time"][1] = max(current["time"][1], next_sub["time"][1])
            if not current.get("en") and next_sub.get("en"):
                current["en"] = next_sub["en"]
        else:
            unique.append(current)
            current = next_sub
    unique.append(current)
    return unique


def make_subtitle_card(entry: dict, output_path: Path, zh_font_size: int, zh_min_size: int, zh_max_lines: int, en_font_size: int, en_min_size: int, en_max_lines: int):
    card = Image.new("RGBA", SUBTITLE_CARD_SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    zh_text_content = to_simplified_chinese(entry.get("zh", entry.get("text", "")))
    en_text_content = entry.get("en", "")

    box_y_offset = 10
    if en_text_content:
        en_font, en_text = fit_text_adaptive(
            draw,
            en_text_content,
            EN_FONTS,
            en_font_size,
            en_min_size,
            960,  # Widen to 960
            220,  # Increase height to 220 for 3 lines with buffer
            max_lines=en_max_lines,
            relax_max_lines=min(3, max(en_max_lines, 2) + 1),
            spacing=6
        )
        en_bbox = text_bbox(draw, en_text, en_font, spacing=6)
        # English text - Removed stroke as per user request
        draw.multiline_text(
            ((SUBTITLE_CARD_SIZE[0] - (en_bbox[2]-en_bbox[0])) / 2, box_y_offset), 
            en_text, 
            font=en_font, 
            fill="white", 
            align="center", 
            spacing=6
        )
        box_y_offset += (en_bbox[3]-en_bbox[1]) + 45  # Increased gap

    if zh_text_content:
        zh_font, zh_text = fit_text_adaptive(
            draw,
            zh_text_content,
            ZH_FONTS,
            zh_font_size,
            zh_min_size,
            920,  # Widen to 920
            320,  # Increase height to 320 for 3 lines with buffer
            max_lines=zh_max_lines,
            relax_max_lines=min(3, max(zh_max_lines, 2) + 1),
            spacing=4
        )
        zh_bbox = text_bbox(draw, zh_text, zh_font, spacing=4)
        box_h = (zh_bbox[3]-zh_bbox[1]) + 40
        box_w = min(1020, max((zh_bbox[2]-zh_bbox[0]) + 100, 420))
        box_pos = ((SUBTITLE_CARD_SIZE[0] - box_w) / 2, box_y_offset)
        # Ensure box doesn't overflow card at the very bottom
        draw.rounded_rectangle((box_pos[0], box_pos[1], box_pos[0] + box_w, box_pos[1] + box_h), radius=26, fill="white")
        text_x = box_pos[0] + (box_w - (zh_bbox[2] - zh_bbox[0])) / 2
        text_y = box_pos[1] + (box_h - (zh_bbox[3] - zh_bbox[1])) / 2 - 2
        draw.multiline_text((text_x, text_y), zh_text, font=zh_font, fill="black", align="center", spacing=4)
        
    output_path.parent.mkdir(parents=True, exist_ok=True)
    card.save(output_path)

def generate_subtitle_cards(subtitles: list[dict], output_dir: Path, zh_font_size: int, zh_min_size: int, zh_max_lines: int, en_font_size: int, en_min_size: int, en_max_lines: int) -> list[dict]:
    output_dir.mkdir(parents=True, exist_ok=True)
    cards = []
    for i, entry in enumerate(subtitles):
        time_data = entry.get("time")
        text_data = entry.get("zh", entry.get("text"))
        if not time_data or len(time_data) < 2 or not text_data:
            print(f"Skipping invalid subtitle entry: {entry}")
            continue
        start, end = float(time_data[0]), float(time_data[1])
        if end <= start:
            print(f"Skipping subtitle with invalid time: {entry}")
            continue
        
        image_path = output_dir / f"subtitle_{i:03d}.png"
        print(f"  -> Generating subtitle card: {image_path.name}")
        make_subtitle_card(entry, image_path, zh_font_size, zh_min_size, zh_max_lines, en_font_size, en_min_size, en_max_lines)
        cards.append({"start": start, "end": end, "path": image_path})
    return cards

def run_ffmpeg(background: Path, input_video: Path, subtitle_cards: list[dict], output_video: Path, subtitle_offset_y: int):
    media_info = probe_media(input_video)
    duration = media_info["duration"]
    has_audio = media_info["has_audio"]
    print(f"INFO: Input video duration={duration:.2f}s, has_audio={has_audio}")

    cmd = ["ffmpeg", "-y", "-loop", "1"]
    if duration > 0:
        cmd.extend(["-t", f"{duration:.3f}"])
    cmd.extend(["-i", str(background), "-i", str(input_video)])
    
    # 关键修复：所有图片输入必须开启 -loop 1，否则在非 0 秒偏移时 FFmpeg 会因找不到帧而挂起/卡死
    for card in subtitle_cards:
        cmd.extend(["-loop", "1", "-i", str(card["path"])])

    # 滤镜链修复：显式应用 setpts=PTS-STARTPTS 确保即使无音轨时时间戳也从 0 开始同步，并强制 30fps 防止丢帧导致卡死
    filter_parts = [
        f"[1:v]setpts=PTS-STARTPTS,scale={VIDEO_FRAME_WIDTH}:{VIDEO_FRAME_HEIGHT}:force_original_aspect_ratio=increase,crop={VIDEO_FRAME_WIDTH}:{VIDEO_FRAME_HEIGHT}:x=(iw-ow)/2:y=0,fps=30[v0]",
        f"[0:v][v0]overlay=0:{VIDEO_FRAME_Y}[base0]"
    ]
    current_label = "base0"
    subtitle_overlay_y = SUBTITLE_OVERLAY_Y + subtitle_offset_y
    for i, card in enumerate(subtitle_cards, start=2):
        next_label = f"base{i-1}"
        visible_end = max(card["start"], card["end"] - SUBTITLE_GAP_SECONDS)
        filter_parts.append(f"[{current_label}][{i}:v]overlay=0:{subtitle_overlay_y}:enable='between(t,{card['start']},{visible_end})'[{next_label}]")
        current_label = next_label

    filter_complex = ";".join(filter_parts)
    cmd.extend([
        "-filter_complex", filter_complex,
        "-map", f"[{current_label}]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p"
    ])
    
    if has_audio:
        cmd.extend(["-map", "1:a:0", "-c:a", "aac", "-b:a", "192k"])
    else:
        cmd.extend(["-an"])
    
    # 强制开启 -shortest 且明确指定主视频时长结束，防止因 looped 图像导致的无限运行
    cmd.extend(["-shortest"])
    if duration > 0:
        cmd.extend(["-t", f"{duration:.3f}"])
    
    cmd.append(str(output_video))
    print("Running FFmpeg command...")
    subprocess.run(cmd, check=True)

# ================== Main Execution ==================
def main():
    emit_stage("vertical_render", "正在生成动态竖屏视频")
    parser = argparse.ArgumentParser(description="Generate dynamic vertical video.")
    parser.add_argument("--input", type=str, default="input.mp4", help="Input video file.")
    parser.add_argument("--content", type=str, default="content.json", help="Content JSON file for title.")
    parser.add_argument("--subtitles", type=str, default="subtitles.json", help="Subtitles JSON file.")
    parser.add_argument("--output", type=str, default="output_9x16.mp4", help="Output video file.")
    parser.add_argument("--background", type=str, default="background_generated.png")
    parser.add_argument("--sub-dir", type=str, default="subtitle_cards")
    parser.add_argument("--title-font-size", type=int, default=DEFAULT_TITLE_FONT_SIZE)
    parser.add_argument("--title-min-size", type=int, default=DEFAULT_TITLE_MIN_SIZE)
    parser.add_argument("--title-max-lines", type=int, default=DEFAULT_TITLE_MAX_LINES)
    parser.add_argument("--subtitle-font-size", type=int, default=DEFAULT_ZH_FONT_SIZE)
    parser.add_argument("--subtitle-min-size", type=int, default=DEFAULT_ZH_MIN_SIZE)
    parser.add_argument("--subtitle-max-lines", type=int, default=DEFAULT_ZH_MAX_LINES)
    parser.add_argument("--subtitle-offset-y", type=int, default=DEFAULT_SUBTITLE_OFFSET_Y)
    parser.add_argument("--english-font-size", type=int, default=DEFAULT_EN_FONT_SIZE)
    parser.add_argument("--english-min-size", type=int, default=DEFAULT_EN_MIN_SIZE)
    parser.add_argument("--english-max-lines", type=int, default=DEFAULT_EN_MAX_LINES)
    args = parser.parse_args()

    base = Path.cwd()
    input_video = base / args.input
    content_file = base / args.content
    subtitles_file = base / args.subtitles
    output_video = base / args.output
    background_png = base / args.background
    subtitle_dir = base / args.sub_dir
    
    # --- RIGOROUS CHECKS ---
    print("\n--- [STEP 1] Verifying all input files ---")
    if not input_video.exists(): raise FileNotFoundError(f"Input video not found: {input_video}")
    if not content_file.exists(): raise FileNotFoundError(f"Content JSON not found: {content_file}")
    
    content = load_json(content_file)
    subtitles = []
    if not subtitles_file.exists():
        print(f"INFO: Subtitles JSON not found at {subtitles_file}. Proceeding without subtitles.")
    else:
        try:
            subtitles = load_json(subtitles_file)
            if not isinstance(subtitles, list):
                print(f"ERROR: subtitles.json is not a list. Content type: {type(subtitles)}")
                subtitles = []
            elif not subtitles:
                print("INFO: Subtitles file is empty (list length is 0).")
            else:
                subtitles = normalize_subtitles_for_display(subtitles)
                subtitles_file.write_text(json.dumps(subtitles, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"INFO: Successfully loaded {len(subtitles)} subtitle entries from {subtitles_file.name}")
        except Exception as e:
            print(f"ERROR: Failed to parse subtitles JSON: {e}")
            subtitles = []

    if subtitles:
        # [NEW] 自动补全翻译、长句子自动拆分与强力去重逻辑
        subtitles = translate_subtitles_batch(subtitles)
        subtitles = split_long_subtitles(subtitles, max_chars=24)
        subtitles = deduplicate_subtitles(subtitles)

    print("\n--- [STEP 2] Generating assets ---")
    emit_stage("vertical_assets", "正在生成竖屏背景与字幕卡")
    make_background(content, background_png, args.title_font_size, args.title_min_size, args.title_max_lines)
    
    subtitle_cards = []
    if subtitles:
        print("Generating subtitle cards...")
        subtitle_cards = generate_subtitle_cards(
            subtitles,
            subtitle_dir,
            args.subtitle_font_size,
            args.subtitle_min_size,
            args.subtitle_max_lines,
            args.english_font_size,
            args.english_min_size,
            args.english_max_lines
        )
        if not subtitle_cards:
            print("WARNING: Failed to generate any subtitle cards from the provided JSON.")
    
    print("\n--- [STEP 3] Running FFmpeg to compose final video ---")
    run_ffmpeg(background_png, input_video, subtitle_cards, output_video, args.subtitle_offset_y)

    print(f"\n✅ Generation complete: {output_video}")
    # Fixed center-crop mode no longer builds a vertical framing plan, but
    # downstream callers still expect the result payload shape to stay stable.
    emit_result(
        "竖屏视频生成完成",
        output_video=str(output_video),
        subtitle_card_count=len(subtitle_cards),
        framing_segment_count=0,
    )

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        emit_error("VERTICAL_RENDER_FAILED", "竖屏视频生成失败", stage="vertical_render", details=str(e), hint="请检查输入视频、字幕文件、字体和 FFmpeg")
        print(f"\n\n--- [FATAL ERROR] ---")
        print(f"An error occurred: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
