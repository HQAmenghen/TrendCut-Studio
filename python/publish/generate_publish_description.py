import argparse
import io
import os
import re
import sys
import warnings

warnings.filterwarnings("ignore", category=FutureWarning, module="google.generativeai")
import google.generativeai as genai

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env

load_project_env(__file__)

DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_MODEL = os.getenv(
    "PUBLISH_DESCRIPTION_GEMINI_MODEL",
    os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL),
)


def configure_gemini() -> None:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("Missing Gemini API key. Set GEMINI_API_KEY or GOOGLE_API_KEY in your environment or .env file.")
    genai.configure(api_key=api_key)


def normalize_output(text: str, strip_tags: bool = True) -> str:
    cleaned = str(text or "").strip()
    cleaned = cleaned.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = re.sub(r"[\"“”‘’]", "", cleaned)
    if strip_tags:
        cleaned = re.sub(r"\s*#[^\s#]+", "", cleaned)
    cleaned = re.sub(r"\n+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate short publish description for WeChat Channels.")
    parser.add_argument("--source-text", required=True, help="Subtitle summary or source transcript snippet.")
    parser.add_argument("--title", default="", help="Preferred publish title or topic anchor.")
    parser.add_argument("--include-tags", action="store_true", help="Append tightly relevant hashtags to the generated description.")
    args = parser.parse_args()

    source_text = normalize_output(args.source_text)
    title = normalize_output(args.title)
    if not source_text:
        print("")
        return

    configure_gemini()
    model = genai.GenerativeModel(GEMINI_MODEL)
    tag_instruction = """
10. 不要输出任何 #话题标签，标签由系统单独追加。
11. 只输出最终文案，不要解释，不要换行。
""".strip()
    if args.include_tags:
        tag_instruction = """
10. 结尾补 3 到 5 个和内容强相关的话题标签，格式示例：#能源#石油#国际财经。
11. 标签必须严格来自原文语义，不能蹭加密货币、区块链、Web3、比特币等无关概念。
12. 只输出最终文案，不要解释，不要换行。
""".strip()

    prompt = f"""
你是一个擅长写时政、财经、产业、科技热点短视频发布文案的中文编辑。

请根据下面的视频内容，写一段适合微信视频号发布的描述文案。

要求：
1. 风格参考财经快讯、人物观点摘录、热点总结，像在转述一条有信息量的市场观点。
2. 核心结构优先写成：人物/机构/主体 + 冒号 + 核心观点总结。
3. 文案要有信息密度，像“谁说了什么、意味着什么”，不要写成生活化闲聊，也不要写成广告。
4. 不要重复标题，不要把标题原样抄进去。
5. 不要输出英文，不要带来源账号、原始链接、emoji、序号。
6. 控制在35到90字，尽量一段写完。
7. 如果内容里有人物、机构、公司、品牌，优先点名主体。
8. 如果给了标题，请把标题视为主题锚点，优先围绕标题中的核心主题词写，但不要原样重复标题。
9. 标题可以帮助你确定主题方向；摘要负责提供可写的事实细节。两者冲突时，以摘要事实为准，不要硬编。
10. 如果标题里有石油、油气、能源、地缘、关税、科技公司等明确主题词，且摘要不冲突，文案里应自然体现这些主题词。
11. 只能依据提供的标题和摘要写，不能脑补未出现的行业、概念、资产、立场或结论。
12. 如果标题和摘要里都没有明确提到加密货币、比特币、区块链、Web3、美股等概念，绝对不要自行加入。
{tag_instruction}

标题：
{title or "（未提供）"}

视频内容：
{source_text}
"""
    response = model.generate_content(prompt)
    print(normalize_output(response.text, strip_tags=not args.include_tags))


if __name__ == "__main__":
    main()
