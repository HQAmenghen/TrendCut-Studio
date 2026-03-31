import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import argparse
import json
import os
import re
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from llm_client import create_llm_client, generate_content, get_llm_provider
from script_protocol import emit_error, emit_result, emit_stage, run_guarded

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
    used_explicit_breaks = len(lines) >= 2

    if not lines:
        return "万事达卡出手\n支付格局要变？"

    merged = "".join(lines)
    merged = re.sub(r"\s+", "", merged)
    merged = re.sub(r"[。；;]+$", "", merged)

    if used_explicit_breaks:
        first = re.sub(r"\s+", "", lines[0]).strip()
        second = re.sub(r"\s+", "", "".join(lines[1:])).strip()
    else:
        split_at = min(max(4, len(merged) // 3), 7)
        first = merged[:split_at]
        second = merged[split_at:]

    if not second:
        second = "支付格局要变？"

    if not used_explicit_breaks:
        first = clamp_line(first, 8)
        second = clamp_line(second, 12)

    if not used_explicit_breaks and len(second) <= len(first):
        pool = (first + second).replace("\n", "")
        split_at = min(max(4, len(pool) // 3), 7)
        first = clamp_line(pool[:split_at], 7)
        second = clamp_line(pool[split_at:], 10)

    if not used_explicit_breaks and len(second) <= len(first) and len(first) > 4:
        move_count = min(2, len(first) - 4)
        second = first[-move_count:] + second
        first = first[:-move_count]

    if not used_explicit_breaks and len(second) <= 2 and len(first) >= 2:
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

    emit_stage("titling", "正在读取字幕并生成标题")
    with open(args.subtitles, "r", encoding="utf-8") as f:
        subtitles = json.load(f)

    transcript_lines = []
    for item in subtitles:
        text = str(item.get("zh") or item.get("text") or "").strip()
        if text:
            transcript_lines.append(text)

    transcript = "\n".join(transcript_lines[:40]).strip()
    if not transcript:
        emit_result("使用默认标题", title="这条消息可能正在改变支付格局")
        print("这条消息可能正在改变支付格局")
        return

    client = create_llm_client()
    prompt = f"""
你是一名顶级短视频封面标题编辑，专门写财经/科技类爆点标题。
请根据下面的口播内容，生成一个真正有冲击力、适合竖屏封面大字的中文标题。

这次不要写空话，不要写泛泛而谈的标题。

硬性要求：
1. 必须输出两行标题，中间用换行符 \\n 分隔。
2. 第一行必须是强钩子，4 到 8 个字，像封面第一眼抓人的大字。
3. 第二行必须是结论升级或悬念追问，7 到 12 个字，而且第二行字数必须多于第一行。
4. 总长度尽量控制在 12 到 18 个中文字符内，越短越有力。
5. 必须点出具体主体或变化，比如“万事达卡”“Visa”“华尔街”“稳定币”“支付格局”等，不能空泛。
6. 语气要像短视频封面，不要写成新闻标题，不要写成公文，不要过于平。
7. 标题必须语义完整、口语自然，绝对不能为了短而省略关键字，不能出现这种不通顺表达：
   - “人类还有饭”
   - “苹果这次真狠”
   - “英伟达已经成”
   正确感觉应该像：
   - “人类还有饭吃吗？”
   - “苹果这次真下场了？”
   - “英伟达真把它做成了？”
8. 如果涉及品牌名、产品名、英文词，必须整体保留，不要拆坏专有名词，例如：
   - iPhone
   - OpenAI
   - Nvidia
   - Bitcoin
9. 第二行优先写成完整短句，哪怕比平时略长一点，也不要残缺。
10. 禁止输出这类空泛表达：
   “发出新信号”
   “风向变了”
   “值得关注”
   “引发热议”
   “未来将如何”
11. 优先使用以下表达策略之一：
   - 大公司突然动作
   - 老规则要变
   - 传统巨头下场
   - 某个行业要被改写
   - 一个动作暴露更大趋势
12. 不要解释，不要给多个候选，不要加引号、emoji、序号。
13. 第一行要明显更短，第二行要更长，但不要为了“长短对比”故意写断裂句、残句或缺字句。
14. 第二行优先用疑问句或完整结论句收尾，例如“要变天了？”“要洗牌了？”“谁还坐得住？”“还有饭吃吗？”
15. 每一行都尽量短促有力，但绝对不要长到可能自动折成第三行。

你要追求的感觉类似：
万事达卡突然出手
传统支付要变天了？

华尔街盯上稳定币
下一场支付战开打？

老牌巨头集体转向
谁还守得住旧规则？

AI自己开公司
人类还有饭吃吗？

iPhone不是玩具
它本来就是奢侈品？

口播内容：
{transcript}
"""
    response = generate_content(
        client,
        model=GEMINI_MODEL,
        contents=prompt,
    )
    title = normalize_title(response.text)
    emit_result("标题生成完成", title=title or "这条消息可能正在改变支付格局")
    print(title or "这条消息可能正在改变支付格局")


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="TITLE_GENERATION_FAILED",
        error_message="自动标题生成失败",
        error_stage="titling",
        hint="请检查 Gemini Key、字幕文件和标题生成脚本输出",
    ))
