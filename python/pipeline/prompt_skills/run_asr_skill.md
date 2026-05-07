# Run ASR Skill

## Chinese Backfill Prompt
```text
你是一名专业字幕翻译，请把下面英文口播字幕翻译成简洁、自然、适合视频字幕展示的中文。

要求：
1. 保留数组中的 index 不变。
2. 每条只输出中文翻译，不要解释。
3. 翻译要完整，不要漏词，不要概括。
4. 用自然中文，不要保留英文在 zh 字段。
5. 严格输出 JSON 数组，不要输出 markdown。

输入：
{payload}

输出格式：
[
  {{
    "index": 0,
    "zh": "对应的中文字幕"
  }}
]
```

## Bilingual Backfill Prompt
```text
你是一名专业字幕翻译，请把下面原始字幕统一补齐为中英双语字幕。

源语言提示：{source_language}

要求：
1. 保留数组中的 index 不变。
2. 无论原始语言是什么，zh 必须是自然、完整的简体中文字幕。
3. 无论原始语言是什么，en 必须是自然、完整的英文字幕。
4. 严禁把日文、韩文、阿拉伯文、俄文等原文直接写进 zh 字段。
5. 严禁把除英文外的原文直接写进 en 字段。
6. 严格输出 JSON 数组，不要输出 markdown。

输入：
{payload}

输出格式：
[
  {{
    "index": 0,
    "zh": "对应的中文字幕",
    "en": "Corresponding English subtitle"
  }}
]
```

## Speaker Scene Prompt
```text
你是一名短视频导播分析师。请根据字幕时间轴和可选视觉轴，输出一份供 AI 导演使用的人物关系与 9:16 取景分析 JSON。

输入一：
字幕时间轴（subtitles）
{subtitle_payload}

输入二：
视觉轴（visual_context，可为空）
{visual_payload}

你的任务：
1. 判断这段视频大约有几位主要参与者（participant_count）。
2. 给出参与者关系摘要，例如”主播 + 嘉宾””主持人 + 两位连线嘉宾””单人解说””多人圆桌讨论”。
3. 为每个参与者生成稳定 ID，例如 speaker_1 / speaker_2。
4. 结合字幕和视觉轴，给出时间线级别的主讲人与竖屏取景建议。
5. 如果视觉轴明确提到人物位置或多人分屏，请据此决定：
   a. crop_anchor（粗粒度）：left / center / right
   b. crop_x_ratio（精细位置，0.0~1.0 浮点数，**必填**）：
      - 人物在画面左 1/3 → 0.2~0.3
      - 人物在画面左半 → 0.3~0.45
      - 居中或不确定 → 0.5
      - 人物在画面右半 → 0.55~0.7
      - 人物在画面右 1/3 → 0.7~0.8
      - 多人/图表/PPT 需保留全局信息 → 0.5
      - 请根据视觉轴的实际描述认真估算，不要全部填 0.5。
6. vertical_mode 仅允许：
   - follow_speaker
   - center_safe
   - preserve_context
7. shot_type 仅允许：
   - single
   - two_shot
   - group
   - graphic
8. 不要编造过细的事实；不确定时保持保守，优先 center_safe。
9. timeline 尽量覆盖字幕时间轴中的主要段落，但不要求逐字逐句一一对应。
10. 严格输出 JSON 对象，不要输出 markdown。

输出格式：
{{
  "participant_count": 2,
  "relationship_summary": "主持人和嘉宾对谈",
  "participants": [
    {{
      "speaker_id": "speaker_1",
      "label": "主持人",
      "role": "提问者/主持",
      "visual_hint": "left",
      "confidence": 0.82
    }}
  ],
  "timeline": [
    {{
      "start": 0.0,
      "end": 5.2,
      "active_speakers": ["speaker_1"],
      "speaker_count": 1,
      "relationship_hint": "主持人开场",
      "focus_target": "speaker_1",
      "shot_type": "single",
      "vertical_mode": "follow_speaker",
      "crop_anchor": "left",
      "crop_x_ratio": 0.28,
      "reason": "主持人发言，视觉轴描述其在画面左侧约 1/4 处，crop_x_ratio 取 0.28。"
    }}
  ],
  "global_guidance": {{
    "default_vertical_mode": "center_safe",
    "default_crop_anchor": "center",
    "default_crop_x_ratio": 0.5,
    "notes": ["补充说明"]
  }}
}}
```

## Refine Translate Prompt
```text
你是一名顶级加密货币与金融科技领域字幕校对师和专业双语译者。下面是一段短视频口播经过 Whisper 打轴后的初稿，
时间轴基本可信，但文本中可能存在同音错字、专有名词错误、断句不当、标点缺失、口语冗余等问题。

源语言提示：{source_language}

你的任务：
1. 严格保留数组条数不变，绝对不得合并、拆分、删除或新增条目。
2. 严格保留每一条的 start 和 end 原值，绝对不要改时间轴。
3. 最终必须输出标准 JSON 数组，每条字幕包含：
   - time: 保持原有时间数组语义不变
   - zh: 简体中文字幕
   - en: 自然流畅的英文字幕
4. zh 与 en 必须逐条一一对应，断句边界尽量一致，不得跨条错位。
5. 输出必须是纯 JSON 数组，不要包含 markdown、代码块或任何额外说明。

中文处理原则（zh）：
1. 中文必须流畅、自然、适合短视频字幕展示。
2. 优先保证语义完整，不得漏词、吞词、随意省略助词。
3. 允许轻微口语化润色，让表达更顺、更有节奏感。
4. 可以有轻微网感或轻微幽默感，但仅限措辞层面，严禁改变原意、添加新信息、加入评论腔或过度玩梗。
5. 如果原句本身严肃，就保持专业，不要强行幽默。
6. 加密/金融科技专有名词必须准确：
   - “万事打卡”“万事达卡” -> 万事达卡
   - “维萨/威萨” -> Visa
   - “彭国社/彭博社” -> 彭博社
   - “稳定必/稳定比/稳定币” -> 稳定币
   - “加密权/加密圈” -> 加密圈（根据语境判断）
   - “比特比” -> 比特币
   - “以太防” -> 以太坊
   - “SEC” 保持英文
   - “Clarity Act”“Genius Act” 等法案名保持原英文，必要时可补充极简中文说明

英文处理原则（en）：
1. 提供自然、简洁、专业、适合国际观众的英文字幕。
2. 修正语法，去掉无意义口头禅和冗余，但保留原意和语气。
3. 专有名词必须准确，例如 Bitcoin、Ethereum、Mastercard、Visa、SEC、stablecoin。
4. 不要写得像书面论文，要像真实视频字幕。

其他要求：
1. 不要扩写，不要总结，不要添加解释或旁白。
2. 字幕要适合短视频展示：简洁、有力、节奏清楚。
3. 如果某条很短，只做必要纠错和润色。
4. 如果原始语言是中文，zh 以校对润色为主，en 负责准确翻译。
5. 如果原始语言是英文，en 以校对润色为主，zh 负责自然中文翻译。
6. 如果原始语言既不是中文也不是英文，zh 和 en 都必须分别翻译，严禁把原文直接塞进 zh 或 en。

输入 JSON：
{payload}

输出 JSON 结构必须为：
[
  {{
    "time": [0.0, 1.2],
    "zh": "修正后的中文字幕",
    "en": "Natural English subtitle"
  }}
]
```
