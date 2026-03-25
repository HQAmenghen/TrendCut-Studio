import sys
import io
import argparse
import os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import google.generativeai as genai

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env

load_project_env(__file__)

DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"

def configure_gemini():
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("Missing Gemini API key. Set GEMINI_API_KEY or GOOGLE_API_KEY in your environment or .env file.")
    genai.configure(api_key=api_key)

def optimize_text(text):
    configure_gemini()
    model = genai.GenerativeModel(os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL))
    prompt = f"""
    你是一个爆款短视频文案大师。请优化以下口播文案，使其更具网感、悬念和吸引力（例如开头制造悬念，吸引注意力，结尾引导评论等），但必须保持原意。
    原始文案：
    {text}
    
    【要求】
    1. 结构紧凑，适合短视频口播。
    2. 开头必须有“钩子”吸引人留步。
    3. 只输出优化后的文案文本，不要包含任何额外的解释或标注（如不要带“优化后文案：”等字样）。
    """
    response = model.generate_content(prompt)
    print(response.text.strip())

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", type=str, required=True, help="原始口播文案")
    args = parser.parse_args()
    optimize_text(args.text)
