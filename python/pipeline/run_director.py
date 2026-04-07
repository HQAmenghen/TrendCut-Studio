import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import json
import os
from pathlib import Path

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

def main():
    emit_stage("director", "正在生成导演混剪方案")
    client = create_llm_client()
    print("1. 正在读取视频脚本和素材分析结果...")

    # 【新增】优先读取 Agent 计划文件
    script_plan_data = None
    material_plan_data = None

    try:
        with open("script_plan.json", "r", encoding="utf-8") as f:
            script_plan_data = f.read()
            print("   ✓ 已读取脚本计划：script_plan.json")
    except FileNotFoundError:
        print("   ⚠️ 未找到 script_plan.json")

    try:
        with open("material_plan.json", "r", encoding="utf-8") as f:
            material_plan_data = f.read()
            print("   ✓ 已读取素材计划：material_plan.json")
    except FileNotFoundError:
        print("   ⚠️ 未找到 material_plan.json")

    # 优先读取 video_script.json（策划阶段产出）
    video_script_data = None
    try:
        with open("video_script.json", "r", encoding="utf-8") as f:
            video_script_data = f.read()
            print("   ✓ 已读取视频脚本：video_script.json")
    except FileNotFoundError:
        print("   ⚠️ 未找到 video_script.json，将回退为基于原始识别结果的独立决策模式")

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

    speaker_scene_data = "{}"
    try:
        with open("speaker_scene.json", "r", encoding="utf-8") as f:
            speaker_scene_data = f.read()
            print("   已读取人物关系分析：speaker_scene.json")
    except FileNotFoundError:
        print("   未找到 speaker_scene.json，将回退为默认居中取景思路。")

    print("2. 正在呼叫 AI 导演进行镜头执行决策...")

    # 【新增】构建 Agent 计划部分
    agent_plans_section = ""
    if script_plan_data or material_plan_data:
        agent_plans_section = f"""
    【Agent 计划指导】（优先级最高）
    """
        if script_plan_data:
            agent_plans_section += f"""
    0a. **脚本计划（script_plan.json）** - Script Planner Agent 产出的分段结构：
    {script_plan_data}

    【重要】：脚本计划已经明确了每段的目标、信息来源和表达方式。你必须严格遵守：
    - preferred_video_source: 决定这段用什么画面（material/mixed/avatar）
    - prefer_source_audio: 决定是否保留素材原声
    - source_basis: 决定信息来源（material/material_plus_post）
    - narration_needed: 决定是否需要数字人口播
    """

        if material_plan_data:
            agent_plans_section += f"""
    0b. **素材计划（material_plan.json）** - Material Planner Agent 产出的高价值片段：
    {material_plan_data}

    【重要】：素材计划已经标记了高价值片段。你应该：
    - 优先使用 priority: "high" 的片段
    - 保留 has_strong_source_audio: true 的片段原声
    - 参考 usage 字段决定片段用途（opening/main_fact_segment/transition/closing）
    """

    # 构建 prompt，如果有 video_script 则优先使用
    video_script_section = ""
    if video_script_data:
        video_script_section = f"""
    0c. **视频脚本（video_script.json）** - 策划阶段产出的完整脚本：
    {video_script_data}

    【重要】：如果提供了视频脚本，你必须优先参考脚本中的 narration_text（口播内容）、visual_intent（画面意图）、allow_broll、preferred_video_source、prefer_source_audio、info_source、supporting_context 来执行镜头决策。
    - 如果 preferred_video_source 为 "material"，说明这一段应优先使用当前素材视频
    - 如果 preferred_video_source 为 "mixed"，说明这一段可以短暂由数字人引入，再回到当前素材视频
    - 如果 prefer_source_audio 为 true，且素材里确实有高信息量原话或关键表态，应优先保留素材原生原话
    - visual_intent 已经明确要求"只用当前素材视频，不补额外素材"，你必须严格遵守
    - 如果 info_source 为 "material_plus_post"，说明这一段允许用一小句原帖文字做补充，但素材内容仍然必须是主线，supporting_context 只能补充，不能盖过素材本身
    """

    prompt = f"""
    你是一位极度克制、以素材事实为第一优先级的短视频执行导演。你的任务不是炫技，而是把"少量数字人串联 + 当前素材主体表达"执行得自然、可信、贴素材。

    【素材输入】
    {agent_plans_section}
    {video_script_section}
    1. A卷：数字人主视频轴（audio.json），包含纯净解说台词：
    {audio_data}

    2. B卷：当前唯一可用的素材视频轴（result.json），包含画面内容和自带原声台词：
    {video_data}

    3. 人物关系与竖屏取景参考（speaker_scene.json），包含主要人物数量、关系、说话时序与 9:16 取景建议：
    {speaker_scene_data}

    【总导演原则】
    1. 最终视频必须体现"素材内容约占 70%，数字人约占 30%"。
    2. 主体表达应由当前素材视频承担；数字人只负责开场抛题、必要串联、少量补充、结尾收束。
    3. 不要把这条视频剪成"数字人一直说，素材只是插图"的结构。
    4. 只允许使用当前这一个 `material.mp4`，绝对不能假设还有图表、地图、额外新闻素材、额外资料镜头。
    5. 剪辑节奏宁可保守，也不要为了"有节奏感"频繁切镜。
    6. 这里的"素材 70%"指的是视觉画面时长占比，而不只是素材原声音频占比。
    7. 如果某段已经使用素材原声，除非万不得已，不要继续配数字人画面；优先直接使用素材画面。

    【信息边界】
    1. 如果素材里已经有关键表态、关键问题、关键数字、关键冲突点，优先保留素材原生原话。
    2. 不要让数字人口播把素材里已经说清楚的话再完整复述一遍。
    3. 如果视频脚本里的某段 `info_source` 是 `material_plus_post`，说明该段允许用一小句原帖信息做补充，但素材内容仍然必须是主线，`supporting_context` 只能补充，不能盖过素材本身。
    4. 不要牵强附会，不要通过镜头选择制造素材本身没有表达出的结论。

    【音频调度原则】
    1. 如果素材原声信息弱、重复或只是背景声，可以播放数字人口播（`audio_source`: "main"`）。
    2. 如果素材原声里有关键原话、提问、表态、强信息量数字，优先切换为素材原声（`audio_source`: "b_roll"`）。
    3. 当素材原声已经足够推动叙事时，优先保留原声，不要为了"有口播"而硬切回数字人。
    4. 如果数字人一句话还没说完整，不能中途切到素材原声；只有当一个完整句子或一个完整意思说完，才允许切到 `audio_source: "b_roll"`。

    【镜头执行原则】
    1. 只在当前素材中选择与脚本语义最贴近的片段。
    2. 如果某段脚本要求保留素材表达，就尽量选择素材中已有对应说话画面或信息密度高的镜头。
    3. 数字人片段要短、准、只起到引导和收束作用。
    4. 每次从数字人切到素材，应该是因为素材本身更有信息价值，而不是因为你想制造节奏。
    5. 除非素材原声确实更有信息量，否则不要在 4 秒内就从数字人切走。
    6. 单个镜头尽量保持 5 到 12 秒，避免 2 到 3 秒一跳的碎切。
    7. 开头至少保留一段完整、稳定的数字人主讲；但结尾不要求一定回到数字人，如果素材原声和素材内容还在推进信息，可以直接用素材收尾。
    8. 尽量避免 `video_source = "aiman.mp4"` 且 `audio_source = "b_roll"` 这种组合；如果用了素材原声，优先同时用素材画面。

    【字幕与文本要求】
    1. A卷（audio.json）的台词是底层 ASR 听写结果，可能含有错别字、断句问题、专有名词错误。
    2. 你需要在输出 `subtitle_text` 时做智能修正，但必须保持原句长度和信息量，不得随意删词、省略、缩写。
    3. `subtitle_text` 必须是观众最终会看到的自然字幕，不能包含"口播：""原声：""素材原声："这类标签。

    【9:16 竖屏规则】
    1. 你需要同时为后续竖屏合成提供取景建议。
    2. 请综合 `speaker_scene.json` 的人物数量、关系、活跃说话人和位置提示，给每个片段输出：
       - `focus_target`: 当前最该跟随的人物 ID，未知时可写 `"context"`
       - `shot_type`: 仅允许 `single` / `two_shot` / `group` / `graphic`
       - `vertical_mode`: 仅允许 `follow_speaker` / `center_safe` / `preserve_context`
       - `crop_anchor`: 仅允许 `left` / `center` / `right`
       - `crop_x_ratio`: 必填，0.0~1.0 的浮点数，表示精确裁剪位置
    3. 如果是多人同框、图表、PPT、信息图，优先使用 `preserve_context` 或 `center_safe`，避免过度裁切丢信息。

    【输出要求】
    输出一份严格连续的 JSON 数组（不要包含 ```json 标记）。时间线必须从 0.0 秒开始，无缝首尾相连，直到整条视频讲完为止。整条视频可以长于数字人主轨，但必须遵守：
    - 数字人主轨时长之外，不能再使用 `audio_source: "main"`。
    - 一旦超过数字人主轨尾部，后续片段必须使用 `material.mp4` + `audio_source: "b_roll"`。
    - 如果素材原声仍然有信息量，允许在数字人结束后继续保留素材尾段来完成表达。
    [
      {{
        "start_time": 0.0,
        "end_time": 3.5,
        "video_source": "aiman.mp4",
        "audio_source": "main",
        "subtitle_text": "数字人说的开场白",
        "focus_target": "speaker_1",
        "shot_type": "single",
        "vertical_mode": "follow_speaker",
        "crop_anchor": "center",
        "crop_x_ratio": 0.5,
        "cut_start": 0.0,
        "cut_end": 3.5
      }},
      {{
        "start_time": 3.5,
        "end_time": 6.0,
        "video_source": "material.mp4",
        "audio_source": "main",
        "subtitle_text": "数字人的画外音解说词",
        "focus_target": "speaker_1",
        "shot_type": "single",
        "vertical_mode": "follow_speaker",
        "crop_anchor": "right",
        "crop_x_ratio": 0.75,
        "cut_start": 1.0,
        "cut_end": 3.5
      }},
      {{
        "start_time": 6.0,
        "end_time": 8.0,
        "video_source": "material.mp4",
        "audio_source": "b_roll",
        "subtitle_text": "素材里的人大喊：太棒了！",
        "focus_target": "context",
        "shot_type": "group",
        "vertical_mode": "preserve_context",
        "crop_anchor": "center",
        "crop_x_ratio": 0.5,
        "cut_start": 4.0,
        "cut_end": 6.0
      }}
    ]
    最后再次自检：
    - 最终序列的 start_time 必须从 0 开始连续，不能有缝隙。
    - `video_source` 只能是 `aiman.mp4` 或 `material.mp4`。
    - 你的方案必须明显体现"当前素材视频为主、数字人为辅、优先保留素材原话"。
    - 不允许借助外部假想素材补完表达。
    - `subtitle_text` 不能含有"口播：""原声：""素材原声："等标签。
    - 如果素材本身还在提供关键信息，不要因为数字人结束了就提前收尾。
    """

    response = generate_content(
        client,
        model=get_text_model(),
        contents=prompt,
        response_mime_type="application/json",
    )
    
    print("3. AI 导演决策完成！结果如下：\n")
    
    try:
        # 解析 AI 导演返回的 JSON 字符串
        result_json = json.loads(response.text)
        print(json.dumps(result_json, indent=4, ensure_ascii=False))
        
        # 保存原始导演方案到 director_raw.json
        with open("director_raw.json", "w", encoding="utf-8") as f:
            json.dump(result_json, f, indent=4, ensure_ascii=False)

        print("\n🎉 成功生成导演原始方案：director_raw.json")
        print("👉 下一步：运行 post_process_director.py 进行后处理，然后运行 build_video.py 开始最终合成！")
        emit_result("导演混剪方案生成完成", director_json="director_raw.json", segment_count=len(result_json))
        
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
