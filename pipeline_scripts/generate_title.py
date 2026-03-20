import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import argparse
import json
import os
import re
import google.generativeai as genai

DEFAULT_GEMINI_API_KEY = "AIzaSyDMmNqLCLnGQnjIK_IdAV4alpj8K2xYnJk"
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-pro")


def configure_gemini():
    api_key = (
        os.getenv("GEMINI_API_KEY")
        or os.getenv("GOOGLE_API_KEY")
        or DEFAULT_GEMINI_API_KEY
    )
    if not api_key:
        raise RuntimeError("Missing Gemini API key.")
    genai.configure(api_key=api_key)


def visible_len(text: str) -> int:
    return len(re.sub(r"\s+", "", text))


def clamp_line(text: str, limit: int) -> str:
    compact = re.sub(r"\s+", "", text).strip()
    if visible_len(compact) <= limit:
        return compact
    return compact[:limit]


def normalize_title(title: str) -> str:
    cleaned = title.replace("\r\n", "\n").replace("\r", "\n").strip()
    cleaned = re.sub(r"[\"“”‘’]", "", cleaned)
    lines = [line.strip("：:，,。.！？!? ") for line in cleaned.split("\n") if line.strip()]

    if not lines:
        return "万事达卡出手\n支付格局要变？"

    merged = "".join(lines)
    merged = re.sub(r"\s+", "", merged)
    merged = re.sub(r"[。；;]+$", "", merged)

    if len(lines) >= 2:
        first = clamp_line(lines[0], 7)
        second = clamp_line("".join(lines[1:]), 10)
    else:
        split_at = min(max(4, len(merged) // 3), 7)
        first = merged[:split_at]
        second = merged[split_at:]

    if not second:
        second = "支付格局要变？"

    first = clamp_line(first, 7)
    second = clamp_line(second, 10)

    if len(second) <= len(first):
        pool = (first + second).replace("\n", "")
        split_at = min(max(4, len(pool) // 3), 7)
        first = clamp_line(pool[:split_at], 7)
        second = clamp_line(pool[split_at:], 10)

    if len(second) <= len(first) and len(first) > 4:
        move_count = min(2, len(first) - 4)
        second = first[-move_count:] + second
        first = first[:-move_count]

    if len(second) <= 2 and len(first) >= 2:
        spill = first[-2:]
        first = first[:-2]
        second = spill + second

    if not re.search(r"[？?！!]$", second):
        second += "？"

    return first + "\n" + second


def main():
    parser = argparse.ArgumentParser(description="Generate a short catchy video title from subtitles.")
    parser.add_argument("--subtitles", default="subtitles.json", help="Subtitle JSON path.")
    args = parser.parse_args()

    with open(args.subtitles, "r", encoding="utf-8") as f:
        subtitles = json.load(f)

    transcript_lines = []
    for item in subtitles:
        text = str(item.get("zh") or item.get("text") or "").strip()
        if text:
            transcript_lines.append(text)

    transcript = "\n".join(transcript_lines[:40]).strip()
    if not transcript:
        print("这条消息可能正在改变支付格局")
        return

    configure_gemini()
    model = genai.GenerativeModel(GEMINI_MODEL)
    prompt = f"""
你是一名顶级短视频封面标题编辑，专门写财经/科技类爆点标题。
请根据下面的口播内容，生成一个真正有冲击力、适合竖屏封面大字的中文标题。

这次不要写空话，不要写泛泛而谈的标题。

硬性要求：
1. 必须输出两行标题，中间用换行符 \\n 分隔。
2. 第一行必须是强钩子，4 到 7 个字，像封面第一眼抓人的大字。
3. 第二行必须是结论升级或悬念追问，6 到 10 个字，而且第二行字数必须多于第一行。
4. 总长度尽量控制在 12 到 16 个中文字符内，越短越有力。
5. 必须点出具体主体或变化，比如“万事达卡”“Visa”“华尔街”“稳定币”“支付格局”等，不能空泛。
6. 语气要像短视频封面，不要写成新闻标题，不要写成公文，不要过于平。
7. 禁止输出这类空泛表达：
   “发出新信号”
   “风向变了”
   “值得关注”
   “引发热议”
   “未来将如何”
8. 优先使用以下表达策略之一：
   - 大公司突然动作
   - 老规则要变
   - 传统巨头下场
   - 某个行业要被改写
   - 一个动作暴露更大趋势
9. 不要解释，不要给多个候选，不要加引号、emoji、序号。
10. 每一行都尽量短促有力，第一行一定更短，第二行一定更长，绝对不要两行长度接近，也绝对不要长到可能自动折成第三行。
11. 第二行优先用疑问句或结论句收尾，例如“要变天了？”“要洗牌了？”“谁还坐得住？”

你要追求的感觉类似：
万事达卡突然出手
传统支付要变天了？

华尔街盯上稳定币
下一场支付战开打？

老牌巨头集体转向
谁还守得住旧规则？

口播内容：
{transcript}
"""
    response = model.generate_content(prompt)
    title = normalize_title(response.text)
    print(title or "这条消息可能正在改变支付格局")


if __name__ == "__main__":
    main()
