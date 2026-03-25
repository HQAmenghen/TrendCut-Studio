import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import google.generativeai as genai
import json
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from script_protocol import emit_error, emit_result, emit_stage, run_guarded

load_project_env(__file__)

DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"

def configure_gemini():
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("Missing Gemini API key. Set GEMINI_API_KEY or GOOGLE_API_KEY in your environment or .env file.")
    genai.configure(api_key=api_key)

def main():
    emit_stage("director", "正在生成导演混剪方案")
    configure_gemini()
    print("1. 正在读取听觉轴 (audio.json) 和视觉轴 (result.json)...")
    
    try:
        with open("audio.json", "r", encoding="utf-8") as f:
            audio_data = f.read()
    except FileNotFoundError:
        print("找不到 audio.json，请先运行 run_asr.py")
        return

    try:
        with open("result.json", "r", encoding="utf-8") as f:
            video_data = f.read()
    except FileNotFoundError:
        print("找不到 result.json，请先运行 VLM 脚本生成视觉轴")
        # 兼容一下：如果文件还在原来的测试文件夹里，就去那里找
        try:
            with open("../test_vlm.py/result.json", "r", encoding="utf-8") as f:
                video_data = f.read()
                print("   (从 ../test_vlm.py/ 目录读取到了 result.json)")
        except:
            return

    print("2. 正在呼叫 AI 导演 (Gemini 1.5 Pro) 进行大模型智能剪辑决策...")
    
    prompt = f"""
    你现在是一位拥有十年商业短片经验的顶级视频剪辑师（AI 导演）。
    我要制作一段“数字人口播+空镜头穿插”的宣传片。不仅画面要混剪，声音和字幕也要智能切换！

    【素材输入】：
    1. A卷：数字人主视频轴（audio.json），包含纯净解说台词：
    {audio_data}

    2. B卷：空镜头素材轴（result.json），包含画面内容和其自带的原声台词：
    {video_data}

    【剪辑与视听绝对红线规则】：
    1. **主宰原则**：`aiman.mp4` 是绝对的核心主视频！你的剪辑总时长必须完全等于 A卷（audio.json）的最后一句台词的结束时间。
    2. **画面分配**：在整个视频中，绝大多数时间必须是数字人（`aiman.mp4`）出镜。只有在 B卷（result.json）中找到了与数字人当前台词**极其高度匹配的画面**时，才允许短暂切入 `material.mp4` 的画面作为覆盖（B-roll）。
    3. **禁止喧宾夺主**：绝对不允许用 `material.mp4` 连续占据大段画面，更不允许直接删掉数字人的戏份。每次切入空镜头的时间建议不超过 3-5 秒，然后必须切回数字人。
    4. **【音频灵活调度策略】**：
       - **默认情况**：播放数字人原声（`audio_source`: "main"）。即便是切入了 B-roll 画面，默认也是静音播放素材，让数字人的声音作为画外音继续解说。
       - **视情况智能切换**：如果你发现 B卷（result.json）的 `audio_transcript` 中有**极其关键、能极大增强视频感染力的原声**（例如：新闻现场重要的采访原声、重大的欢呼声、不可替代的关键对白），并且此时切断数字人的解说不会导致剧情断层，你**可以自主决定**将音频切换为素材原声（`audio_source`: "b_roll"）。如果只是普通的背景音或不重要的路人说话，请保持素材静音，让数字人继续做画外音。
    5. **【字幕翻译与智能精修 (大模型核心任务)】**：
       - A卷（audio.json）的台词是底层机器语音识别（ASR）直接转录的原始听写记录。**其中必定包含大量的同音错别字、不通顺的断句、口误、甚至是完全听错的专业名词**！
       - 请你**发挥作为顶级大模型的逻辑推理和语言理解能力**，在输出 `subtitle_text` 字段时，不要机械照搬原始数据。
       - **强制动作与字数红线**：结合上下文语境强行纠正所有错别字。**【极其重要】：绝对不允许擅自删减字数、缩写或省略任何词语（例如决不能把“已经”缩减为“已”）！你必须严格保持原始台词的字数长度和完整性，只做同音错别字替换，否则会导致字幕和画面口型严重脱节！** 如果原始素材包含外语，请提供字数适中的中文精翻。
       - 你的 `subtitle_text` 就是最终呈现在屏幕上的硬字幕，绝不能出现类似“万事打卡”、“彭国社”等低级同音字错误。

    【输出要求】：
    输出一份严格连续的 JSON 数组（不要包含 ```json 标记）。时间线必须从 0.0 秒开始，无缝首尾相连，直到数字人视频结束：
    [
      {{
        "start_time": 0.0,
        "end_time": 3.5,
        "video_source": "aiman.mp4",
        "audio_source": "main",
        "subtitle_text": "数字人说的开场白",
        "cut_start": 0.0,
        "cut_end": 3.5
      }},
      {{
        "start_time": 3.5,
        "end_time": 6.0,
        "video_source": "material.mp4",
        "audio_source": "main",
        "subtitle_text": "数字人的画外音解说词",
        "cut_start": 1.0,
        "cut_end": 3.5
      }},
      {{
        "start_time": 6.0,
        "end_time": 8.0,
        "video_source": "material.mp4",
        "audio_source": "b_roll",
        "subtitle_text": "素材里的人大喊：太棒了！",
        "cut_start": 4.0,
        "cut_end": 6.0
      }}
    ]
    注意：最终序列的 start_time 必须从 0 开始连续，不能有缝隙！
    """

    model = genai.GenerativeModel(os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL))
    
    # 强制让大模型吐出标准 JSON 格式
    response = model.generate_content(
        prompt,
        generation_config={"response_mime_type": "application/json"}
    )
    
    print("3. AI 导演决策完成！结果如下：\n")
    
    try:
        # 解析 AI 导演返回的 JSON 字符串
        result_json = json.loads(response.text)
        print(json.dumps(result_json, indent=4, ensure_ascii=False))
        
        # 覆写保存到 director.json
        with open("director.json", "w", encoding="utf-8") as f:
            json.dump(result_json, f, indent=4, ensure_ascii=False)
        
        print("\n🎉 成功生成完美的剪辑方案：director.json")
        print("👉 下一步：直接运行 python build_video.py 开始最终合成！")
        emit_result("导演混剪方案生成完成", director_json="director.json", segment_count=len(result_json))
        
    except json.JSONDecodeError:
        emit_error("DIRECTOR_RESULT_PARSE_FAILED", "导演结果解析失败", stage="director", details=response.text)
        raise RuntimeError("解析 JSON 失败，AI 返回的内容格式有误")

if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="DIRECTOR_FAILED",
        error_message="导演混剪方案生成失败",
        error_stage="director",
        hint="请检查 audio.json、result.json、Gemini Key 和模型返回格式",
    ))
