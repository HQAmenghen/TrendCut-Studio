import json
import subprocess
import sys
from pathlib import Path
import argparse
from PIL import Image, ImageDraw, ImageFont
import re

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from script_protocol import emit_error, emit_result, emit_stage

# 终极防崩溃补丁
sys.stdout.reconfigure(encoding='utf-8')

# ================== Hardcoded Configs ==================
WIDTH = 1080
HEIGHT = 1920
TITLE_BOX = (84, 108, 960, 430)
SUBTITLE_CARD_SIZE = (1080, 360)
SUBTITLE_OVERLAY_Y = 1220
DEFAULT_SUBTITLE_OFFSET_Y = 20
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
DEFAULT_ZH_MIN_SIZE = 28
DEFAULT_ZH_MAX_LINES = 2
DEFAULT_EN_FONT_SIZE = 52
DEFAULT_EN_MIN_SIZE = 30
DEFAULT_EN_MAX_LINES = 2

# ================== Helper Functions ==================
def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)

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

    tokens = [token for token in tokenize_text_units(compact) if token.strip()]
    if len(tokens) < 2:
        return lines

    best_pair = None
    best_score = float("inf")
    for index in range(1, len(tokens)):
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
            # If it still doesn't fit, keep punctuation attached by trimming the previous line tail.
            merged_fitted = fit_single_line(merged, font, max_width, **bbox_kwargs)
            normalized[-1] = merged_fitted
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
                if visible_text_len(candidate) >= visible_text_len(prev):
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

def make_subtitle_card(entry: dict, output_path: Path, zh_font_size: int, zh_min_size: int, zh_max_lines: int, en_font_size: int, en_min_size: int, en_max_lines: int):
    card = Image.new("RGBA", SUBTITLE_CARD_SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    zh_text_content = entry.get("zh", entry.get("text", ""))
    en_text_content = entry.get("en", "")

    box_y_offset = 10
    if en_text_content:
        en_font, en_text = fit_text(draw, en_text_content, EN_FONTS, en_font_size, en_min_size, 860, 110, max_lines=en_max_lines, spacing=6)
        en_bbox = text_bbox(draw, en_text, en_font, spacing=6)
        draw.multiline_text(((SUBTITLE_CARD_SIZE[0] - (en_bbox[2]-en_bbox[0])) / 2, box_y_offset), en_text, font=en_font, fill="white", align="center", spacing=6)
        box_y_offset += (en_bbox[3]-en_bbox[1]) + 38

    if zh_text_content:
        zh_font, zh_text = fit_text(draw, zh_text_content, ZH_FONTS, zh_font_size, zh_min_size, 760, 150, max_lines=zh_max_lines, spacing=4)
        zh_bbox = text_bbox(draw, zh_text, zh_font, spacing=4)
        box_h = (zh_bbox[3]-zh_bbox[1]) + 40
        box_w = min(920, max((zh_bbox[2]-zh_bbox[0]) + 100, 420))
        box_pos = ((SUBTITLE_CARD_SIZE[0] - box_w) / 2, box_y_offset)
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
    cmd = ["ffmpeg", "-y", "-loop", "1", "-i", str(background), "-i", str(input_video)]
    for card in subtitle_cards:
        cmd.extend(["-i", str(card["path"])])

    filter_parts = ["[1:v]scale=1080:608:force_original_aspect_ratio=increase,crop=1080:608[v0]", "[0:v][v0]overlay=0:560[base0]"]
    current_label = "base0"
    subtitle_overlay_y = SUBTITLE_OVERLAY_Y + subtitle_offset_y
    for i, card in enumerate(subtitle_cards, start=2):
        next_label = f"base{i-1}"
        visible_end = max(card["start"], card["end"] - SUBTITLE_GAP_SECONDS)
        filter_parts.append(f"[{current_label}][{i}:v]overlay=0:{subtitle_overlay_y}:enable='between(t,{card['start']},{visible_end})'[{next_label}]")
        current_label = next_label

    filter_complex = ";".join(filter_parts)
    cmd.extend([
        "-filter_complex", filter_complex, "-map", f"[{current_label}]", "-map", "1:a?",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-shortest", str(output_video)
    ])
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
        print("WARNING: Subtitles JSON not found. Proceeding without subtitles.")
    else:
        subtitles = load_json(subtitles_file)
        if not isinstance(subtitles, list):
            print(f"ERROR: subtitles.json is not a list. Content: {subtitles}")
            subtitles = []
        elif not subtitles:
            print("INFO: Subtitles file is empty. Proceeding without subtitles.")

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
    emit_result("竖屏视频生成完成", output_video=str(output_video), subtitle_card_count=len(subtitle_cards))

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
