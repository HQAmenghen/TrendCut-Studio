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
from gemini_client import create_gemini_client, delete_file, generate_content, upload_file, wait_for_file_ready
from script_protocol import emit_error, emit_result, emit_stage, run_guarded

load_project_env(__file__)

VIDEO_PATH = "material.mp4"
DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"
def main():
    emit_stage("vlm", "正在分析素材画面与音频")
    client = create_gemini_client()
    print(f"1. 准备上传视频: {VIDEO_PATH} ...")
    
    # 上传视频到 Google 云端
    try:
        video_file = upload_file(client, VIDEO_PATH)
        print(f"   上传成功！云端文件名: {video_file.name}")
    except Exception as e:
        raise RuntimeError(f"上传失败，请检查网络或路径: {e}")

    # 视频上传后，Google 需要几秒钟到十几秒来处理（抽帧/提取音频）
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

    # 定义我们要用的模型
    # 明确告诉模型我们要什么，并要求输出 JSON (增加音频识别)
    prompt = """
    你是一个专业的视频与音频分析引擎。请仔细观看并聆听这段空镜头素材视频。
    请严格输出 JSON 格式，不要包含任何 markdown 标记。
    
    需要的 JSON 结构示例：
    {
      "summary": "一句话概括视频内容",
      "visual_timeline": [
        {"time": "00:00-00:05", "action": "画面显示水花飞溅"},
        {"time": "00:05-00:20", "action": "画面显示钛金属特写"}
      ],
      "audio_transcript": [
        {"time": "00:00-00:03", "text": "素材里的人物原声说话内容（如果没有说话，请留空或写'无明显人声'）"}
      ]
    }
    """

    print("3. 开始请求 Gemini 模型进行分析...")
    # generation_config 强制要求模型只返回 application/json 格式
    response = generate_content(
        client,
        model=os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL),
        contents=[prompt, video_file],
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

    # 5. 用完记得清理云端文件，养成好习惯（否则占你 Google 云盘配额）
    print("5. 清理云端临时视频文件...")
    delete_file(client, video_file.name)
    print("流程结束。")

if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="VLM_FAILED",
        error_message="视频 VLM 分析失败",
        error_stage="vlm",
        hint="请检查素材视频、Gemini Key 和网络连通性",
    ))
