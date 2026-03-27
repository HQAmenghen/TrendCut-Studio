import sys
import io
import argparse
import os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from gemini_client import create_gemini_client, generate_content
from script_protocol import emit_result, emit_stage, run_guarded

load_project_env(__file__)

DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"
def optimize_text(text):
    emit_stage("optimize_text", "正在优化口播文案")
    client = create_gemini_client()
    prompt = f"""
    你是一个爆款短视频文案大师。请优化以下口播文案，使其更具网感、悬念和吸引力（例如开头制造悬念，吸引注意力，结尾引导评论等），但必须保持原意。
    原始文案：
    {text}
    
    【要求】
    1. 结构紧凑，适合短视频口播。
    2. 开头必须有“钩子”吸引人留步。
    3. 只输出优化后的文案文本，不要包含任何额外的解释或标注（如不要带“优化后文案：”等字样）。
    """
    response = generate_content(
        client,
        model=os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL),
        contents=prompt,
    )
    optimized = response.text.strip()
    emit_result("文案优化完成", text=optimized)
    print(optimized)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", type=str, required=True, help="原始口播文案")
    args = parser.parse_args()
    sys.exit(run_guarded(
        lambda: optimize_text(args.text),
        error_code="OPTIMIZE_TEXT_FAILED",
        error_message="文案优化失败",
        error_stage="optimize_text",
        hint="请检查 Gemini Key、模型配置和输入文案",
    ))
