import json
import subprocess
import sys
from pathlib import Path
import argparse
from PIL import Image, ImageDraw, ImageFont
import re

# 终极防崩溃补丁
sys.stdout.reconfigure(encoding='utf-8')

# ================== Hardcoded Configs ==================
WIDTH = 1080
HEIGHT = 1920
TITLE_BOX = (84, 108, 960, 430)
SUBTITLE_CARD_SIZE = (1080, 360)
SUBTITLE_OVERLAY_Y = 1220
SUBTITLE_GAP_SECONDS = 0.08
TITLE_FONTS = [ r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\simhei.ttf" ]
ZH_FONTS = TITLE_FONTS
EN_FONTS = [ r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\arial.ttf" ]

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

def wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int, **kwargs) -> str:
    bbox_kwargs = kwargs.copy()
    bbox_kwargs.pop('spacing', None)

    def tokenize(line: str) -> list[str]:
        tokens = re.findall(r"[A-Za-z0-9%$#@&+\-_/.:]+|\s+|.", line)
        return tokens or [line]

    wrapped_lines = []
    for raw_line in text.split('\n'):
        line = raw_line.strip()
        if not line:
            wrapped_lines.append("")
            continue

        current_line = ""
        for token in tokenize(line):
            candidate = token if not current_line else current_line + token
            if font.getbbox(candidate, **bbox_kwargs)[2] <= max_width:
                current_line = candidate
            else:
                if current_line:
                    wrapped_lines.append(current_line.strip())
                    current_line = token.strip()
                else:
                    current_line = token.strip()
        if current_line:
            wrapped_lines.append(current_line.strip())

    return '\n'.join(wrapped_lines)

def fit_text(draw: ImageDraw.ImageDraw, text: str, font_candidates: list[str], start_size: int, min_size: int, max_width: int, max_height: int, **kwargs) -> tuple[ImageFont.FreeTypeFont, str]:
    for size in range(start_size, min_size - 1, -2):
        font = resolve_font(font_candidates, size)
        wrapped = wrap_text(draw, text, font, max_width, **kwargs)
        bbox = text_bbox(draw, wrapped, font, **kwargs)
        if (bbox[2] - bbox[0] <= max_width) and (bbox[3] - bbox[1] <= max_height):
            return font, wrapped
    return font, wrapped

def make_background(content: dict, output_path: Path):
    # Simplified background generation
    image = Image.new("RGB", (WIDTH, HEIGHT), "#0E5FB5")
    draw = ImageDraw.Draw(image)
    if "title" in content and content["title"]:
        title_font, title_text = fit_text(
            draw,
            content["title"],
            TITLE_FONTS,
            104,
            60,
            TITLE_BOX[2] - TITLE_BOX[0],
            TITLE_BOX[3] - TITLE_BOX[1],
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

def make_subtitle_card(entry: dict, output_path: Path):
    card = Image.new("RGBA", SUBTITLE_CARD_SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    zh_text_content = entry.get("zh", entry.get("text", ""))
    en_text_content = entry.get("en", "")

    box_y_offset = 10
    if en_text_content:
        en_font, en_text = fit_text(draw, en_text_content, EN_FONTS, 52, 34, 860, 110, spacing=6)
        en_bbox = text_bbox(draw, en_text, en_font, spacing=6)
        draw.multiline_text(((SUBTITLE_CARD_SIZE[0] - (en_bbox[2]-en_bbox[0])) / 2, box_y_offset), en_text, font=en_font, fill="white", align="center", spacing=6)
        box_y_offset += (en_bbox[3]-en_bbox[1]) + 38

    if zh_text_content:
        zh_font, zh_text = fit_text(draw, zh_text_content, ZH_FONTS, 50, 32, 760, 150, spacing=4)
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

def generate_subtitle_cards(subtitles: list[dict], output_dir: Path) -> list[dict]:
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
        make_subtitle_card(entry, image_path)
        cards.append({"start": start, "end": end, "path": image_path})
    return cards

def run_ffmpeg(background: Path, input_video: Path, subtitle_cards: list[dict], output_video: Path):
    cmd = ["ffmpeg", "-y", "-loop", "1", "-i", str(background), "-i", str(input_video)]
    for card in subtitle_cards:
        cmd.extend(["-i", str(card["path"])])

    filter_parts = ["[1:v]scale=1080:608:force_original_aspect_ratio=increase,crop=1080:608[v0]", "[0:v][v0]overlay=0:560[base0]"]
    current_label = "base0"
    for i, card in enumerate(subtitle_cards, start=2):
        next_label = f"base{i-1}"
        visible_end = max(card["start"], card["end"] - SUBTITLE_GAP_SECONDS)
        filter_parts.append(f"[{current_label}][{i}:v]overlay=0:{SUBTITLE_OVERLAY_Y}:enable='between(t,{card['start']},{visible_end})'[{next_label}]")
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
    parser = argparse.ArgumentParser(description="Generate dynamic vertical video.")
    parser.add_argument("--input", type=str, default="input.mp4", help="Input video file.")
    parser.add_argument("--content", type=str, default="content.json", help="Content JSON file for title.")
    parser.add_argument("--subtitles", type=str, default="subtitles.json", help="Subtitles JSON file.")
    parser.add_argument("--output", type=str, default="output_9x16.mp4", help="Output video file.")
    parser.add_argument("--background", type=str, default="background_generated.png")
    parser.add_argument("--sub-dir", type=str, default="subtitle_cards")
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
    make_background(content, background_png)
    
    subtitle_cards = []
    if subtitles:
        print("Generating subtitle cards...")
        subtitle_cards = generate_subtitle_cards(subtitles, subtitle_dir)
        if not subtitle_cards:
            print("WARNING: Failed to generate any subtitle cards from the provided JSON.")
    
    print("\n--- [STEP 3] Running FFmpeg to compose final video ---")
    run_ffmpeg(background_png, input_video, subtitle_cards, output_video)

    print(f"\n✅ Generation complete: {output_video}")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n\n--- [FATAL ERROR] ---")
        print(f"An error occurred: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
