import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import time
import os
import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from llm_client import create_llm_client, delete_file, generate_content, upload_file, wait_for_file_ready, get_llm_provider
from script_protocol import emit_error, emit_result, emit_stage, run_guarded
from pipeline.skills.prompt_skill_loader import load_prompt_text

load_project_env(__file__)

VIDEO_PATH = "material.mp4"
DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"
DEFAULT_QWEN_MODEL = "qwen3-vl-flash"
VIDEO_VLM_PROMPT = load_prompt_text("video_vlm_skill.md")

def get_vl_model():
    """获取视觉语言模型"""
    provider = get_llm_provider()
    if provider == "qwen":
        return os.getenv("QWEN_VL_MODEL", DEFAULT_QWEN_MODEL)
    else:
        return os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)


def encode_video_to_base64(video_path: str) -> tuple[str, str]:
    """将视频编码为 base64（用于 Qwen）"""
    import base64
    with open(video_path, 'rb') as f:
        video_data = f.read()

    ext = os.path.splitext(video_path)[1].lower()
    mime_type_map = {
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.webm': 'video/webm'
    }
    mime_type = mime_type_map.get(ext, 'video/mp4')

    return base64.b64encode(video_data).decode('utf-8'), mime_type
def main():
    emit_stage("vlm", "正在分析素材画面与音频")
    client = create_llm_client()
    provider = get_llm_provider()

    # 根据提供商选择不同的处理方式
    if provider == "gemini":
        # Gemini: 使用文件上传
        print(f"1. 准备上传视频: {VIDEO_PATH} ...")

        try:
            video_file = upload_file(client, VIDEO_PATH)
            print(f"   上传成功！云端文件名: {video_file.name}")
        except Exception as e:
            raise RuntimeError(f"上传失败，请检查网络或路径: {e}")

        print("2. 等待云端处理视频 (大约需要 10-20 秒)...")
        while True:
            state_name = str(getattr(getattr(video_file, "state", None), "name", getattr(video_file, "state", "")) or "").upper()
            if state_name and state_name != "PROCESSING":
                break
            print("   处理中...")
            time.sleep(3)
            video_file = wait_for_file_ready(client, video_file, poll_seconds=3, timeout_seconds=180)
            break

        state_name = str(getattr(getattr(video_file, "state", None), "name", getattr(video_file, "state", "")) or "").upper()
        if state_name == "FAILED":
            raise RuntimeError("视频处理失败")

        print("✅ 视频处理完成！")
        video_content = video_file

    else:
        # Qwen: 使用原生 file:// 本地文件路径
        print(f"1. 准备本地视频文件: {VIDEO_PATH} ...")
        video_size_mb = os.path.getsize(VIDEO_PATH) / (1024 * 1024)
        print(f"   视频大小: {video_size_mb:.2f} MB")
        video_content = {
            "local_path": str(Path(VIDEO_PATH).resolve()),
            "media_type": "video",
            "fps": 2,
        }
        print("✅ 已切换为 Qwen 原生本地文件模式，无需 base64 编码")

    # 定义我们要用的模型
    # 明确告诉模型我们要什么，并要求输出 JSON (增加音频识别)
    prompt = VIDEO_VLM_PROMPT

    print("3. 开始请求模型进行分析...")
    # generation_config 强制要求模型只返回 application/json 格式
    response = generate_content(
        client,
        model=get_vl_model(),
        contents=[prompt, video_content],
        response_mime_type="application/json",
    )
    
    print("4. 分析结果如下：\n")
    # 因为强制了 JSON 输出，所以直接用 json.loads 就能完美解析
    try:
        result = json.loads(response.text)
        # 打印出漂亮的 JSON 格式
        print(json.dumps(result, indent=4, ensure_ascii=False))
        
        # 将结果保存到本地文件
        with open("result.json", "w", encoding="utf-8") as f:
            json.dump(result, f, indent=4, ensure_ascii=False)
        print("\n✅ 结果已保存为 result.json")
        emit_result(
            "VLM 分析完成",
            result_json="result.json",
            visual_timeline_count=len(result.get("visual_timeline", []) or []),
            audio_transcript_count=len(result.get("audio_transcript", []) or []),
        )
        
    except json.JSONDecodeError:
        emit_error("VLM_RESULT_PARSE_FAILED", "VLM 返回结果解析失败", stage="vlm", details=response.text)
        raise RuntimeError("解析 JSON 失败，模型返回的内容格式不对")

    # 5. 清理云端文件（仅 Gemini 需要）
    if provider == "gemini":
        print("5. 清理云端临时视频文件...")
        delete_file(client, video_content.name)
    print("流程结束。")

if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="VLM_FAILED",
        error_message="视频 VLM 分析失败",
        error_stage="vlm",
        hint="请检查素材视频、Gemini Key 和网络连通性",
    ))
