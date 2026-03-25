import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import google.generativeai as genai
import time
import os
import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env

load_project_env(__file__)

VIDEO_PATH = "material.mp4"
DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"

def configure_gemini():
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("Missing Gemini API key. Set GEMINI_API_KEY or GOOGLE_API_KEY in your environment or .env file.")
    genai.configure(api_key=api_key)

def main():
    configure_gemini()
    print(f"1. 准备上传视频: {VIDEO_PATH} ...")
    
    # 上传视频到 Google 云端
    try:
        video_file = genai.upload_file(path=VIDEO_PATH)
        print(f"   上传成功！云端文件名: {video_file.name}")
    except Exception as e:
        print(f"上传失败，请检查网络或路径: {e}")
        return

    # 视频上传后，Google 需要几秒钟到十几秒来处理（抽帧/提取音频）
    print("2. 等待云端处理视频 (大约需要 10-20 秒)...")
    while video_file.state.name == "PROCESSING":
        print("   处理中...")
        time.sleep(3)
        # 刷新状态
        video_file = genai.get_file(video_file.name)

    if video_file.state.name == "FAILED":
        print("❌ 视频处理失败。")
        return
        
    print("✅ 视频处理完成！")

    # 定义我们要用的模型
    model = genai.GenerativeModel(os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL))
    
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
    response = model.generate_content(
        [video_file, prompt],
        generation_config={"response_mime_type": "application/json"}
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
        
    except json.JSONDecodeError:
        print("❌ 解析 JSON 失败，模型返回的内容可能格式不对：")
        print(response.text)

    # 5. 用完记得清理云端文件，养成好习惯（否则占你 Google 云盘配额）
    print("5. 清理云端临时视频文件...")
    genai.delete_file(video_file.name)
    print("流程结束。")

if __name__ == "__main__":
    main()
