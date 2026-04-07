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
from llm_client import create_llm_client, generate_content, get_llm_provider
from script_protocol import emit_result, emit_stage, run_guarded

load_project_env(__file__)

DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"
DEFAULT_QWEN_MODEL = "qwen3.5-plus"
FORBIDDEN_TERMS = [
    "数字人",
    "原片",
    "原视频",
    "深度拆解",
    "带你拆解",
    "先看视频",
    "先看原片",
    "更多内容请看视频",
]

def get_text_model():
    """获取文本生成模型"""
    provider = get_llm_provider()
    if provider == "qwen":
        return os.getenv("QWEN_TEXT_MODEL", DEFAULT_QWEN_MODEL)
    else:
        return os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)

def contains_forbidden_terms(text):
    normalized = str(text or "")
    return [term for term in FORBIDDEN_TERMS if term in normalized]

def optimize_text(text):
    emit_stage("optimize_text", "正在优化口播文案")
    client = create_llm_client()
    base_prompt = f"""
    你是一个爆款短视频口播文案编辑。请优化以下口播文案，使其更具网感、悬念和吸引力，但必须保持原意，输出要像成片里可以直接念出来的自然中文口播。
    原始文案：
    {text}
    
    【要求】
    1. 结构紧凑，适合短视频口播。
    2. 开头必须有“钩子”吸引人留步。
    3. 只输出优化后的文案文本，不要包含任何额外的解释或标注（如不要带“优化后文案：”等字样）。
    4. 禁止加入流程型串场句、幕后说明、制作说明、镜头说明，例如“先看原片”“先看原视频”“结合原片”“再用数字人”“数字人带你拆解”“带你深度拆解”“下面看视频”“更多内容请看视频”等。
    5. 禁止加入空泛互动套话，例如“评论区聊聊你的看法”“你觉得能涨多少”“欢迎留言讨论”，除非原文里本来就明确要求保留互动收尾。
    6. 禁止把文案写成“介绍接下来要做什么”，而是直接进入信息本身，像新闻解读和观点口播一样一口气讲完。
    7. 如果原文本身已经足够有力，优先做精修，不要为了“更像短视频”硬塞套路句。
    """
    prompt = base_prompt
    optimized = ""
    for attempt in range(2):
        response = generate_content(
            client,
            model=get_text_model(),
            contents=prompt,
        )
        optimized = response.text.strip()
        matched = contains_forbidden_terms(optimized)
        if not matched:
            break
        if attempt == 0:
            prompt = base_prompt + f"""

【额外强制要求】
- 你上一版输出触发了禁用词：{", ".join(matched)}
- 新一版必须彻底避免这些词，尤其不能出现“数字人”相关表述。
- 不要解释，不要道歉，直接重写一版自然口播。
"""
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
