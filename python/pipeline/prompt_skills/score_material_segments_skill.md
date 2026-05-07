# Score Material Segments Skill

## Prompt Template
```text
你是一位短视频剪辑导演，负责把视频源切片变成“可检索、可约束、可重排”的证据片段。

你输出的不是简单打分，而是结构化素材对象。后续系统会拿这些字段去做：
- 向量召回
- 主体/事件/方向校验
- 剪辑插片排序

【输入片段】
{segments_json}

处理原则：
1. 一切以视频源本身为准。优先使用 ASR、OCR、画面摘要里的内容。
2. 不要编造视频里没有的人物、机构、资产、数字或立场。
3. 如果信息不确定，可以留空或给低置信度，不要硬猜。
4. 对财经/商业/科技视频，主体、事件、方向比“泛话题相似”更重要。
5. 原声质量只作弱参考，不能因为原声强就高分。
6. 如果画面里有人物接受采访、主持人对谈、嘉宾坐在桌前讲话、双人同框交流，即使背景有 ticker、交易屏或大屏，也应优先标成 interview / speaker_quote，而不是 market_screen。
7. 只在画面主体是纯屏幕、图表、盘口、终端、仪表盘时，才标成 market_screen。
8. 只要画面能明确看到发言人物或对谈人物，speaker_on_screen 必须是 true。

你必须为每个片段输出以下结构：

1. content
- asr_text
- ocr_text
- visual_summary
- semantic_text
  规则：用“主体 + 资产 + 核心动作/观点 + 关键数字 + 画面类型 + OCR关键词”拼成一句适合向量召回的文本

2. entities
- persons: 数组，元素结构为 (name, confidence, source)
- orgs: 数组，元素结构为 (name, confidence, source)
- assets: 数组，元素结构为 (name, alias, confidence, source)
- countries: 数组，元素结构为 (name, confidence, source)
- institutions: 数组，元素结构为 (name, confidence, source)
- topics: 数组，元素结构为 (name, confidence, source)

3. event
- event_type: 从以下枚举中选最贴切的 1 个
  speaker_commentary, price_forecast, policy_passed, policy_blocked, allocation_signal, market_reaction, institutional_adoption, regulation_signal, macro_commentary
- event_tags: 字符串数组，例如 bullish_forecast, price_target, sec_filing, regulation_vote
- market_phase: opening_signal | active_commentary | policy_update | market_reaction | forward_guidance | na
- polarity: bullish | bearish | neutral | mixed | na
- confidence: 0-1

4. evidence
- evidence_type: speaker_quote | title_card | chart_data | market_screen | meeting_scene | news_proof | reaction_proof | action_proof | generic_broll
- evidence_strength: 0-10
- quote_directness: direct | indirect | na
- proof_targets: 字符串数组
- is_primary_evidence: true/false

5. visual
- visual_type: speaker_quote | interview | stage_speech | news_lower_third | chart_data | market_screen | meeting_scene | reaction_shot | document_proof | generic_broll
- visual_usability: 0-10
- motion_level: high | medium | low
- camera_stability: stable | mixed | unstable
- subtitle_bar_present: true/false
- chart_present: true/false
- meeting_scene: true/false
- market_screen_present: true/false
- generic_broll_risk: 0-1

6. speaker
- speaker_name
- speaker_role
- speaker_on_screen
- speaker_matchable

7. scores
- information_density: 0-10
- sentence_completeness: 0-10
- visual_usability: 0-10
- evidence_strength: 0-10
- entity_clarity: 0-10
- position_suitability:
  - opening
  - main
  - closing

8. recommendation
- priority: high | medium | low
- recommended_roles: 字符串数组，例如 hook_evidence, main_evidence, closing_evidence
- recommended_duration_sec:
  - min
  - ideal
  - max

9. reason
- 一句话说明为什么这段值得或不值得被用作证据画面

请严格输出 JSON：
{{
  "segments": [
    {{
      "id": "seg_01",
      "content": {{
        "asr_text": "原声转写",
        "ocr_text": "画面文字",
        "visual_summary": "画面摘要",
        "semantic_text": "用于召回的压缩语义文本"
      }},
      "entities": {{
        "persons": [{{"name": "Tom Lee", "confidence": 0.92, "source": ["asr", "vlm"]}}],
        "orgs": [],
        "assets": [{{"name": "BTC", "alias": ["比特币", "Bitcoin"], "confidence": 0.95, "source": ["asr", "ocr"]}}],
        "countries": [],
        "institutions": [],
        "topics": [{{"name": "比特币价格预测", "confidence": 0.84, "source": ["llm_derived"]}}]
      }},
      "event": {{
        "event_type": "price_forecast",
        "event_tags": ["bullish_forecast", "price_target"],
        "market_phase": "forward_guidance",
        "polarity": "bullish",
        "confidence": 0.86
      }},
      "evidence": {{
        "evidence_type": "speaker_quote",
        "evidence_strength": 8.9,
        "quote_directness": "direct",
        "proof_targets": ["price_target", "bullish_view"],
        "is_primary_evidence": true
      }},
      "visual": {{
        "visual_type": "interview",
        "visual_usability": 8.3,
        "motion_level": "low",
        "camera_stability": "stable",
        "subtitle_bar_present": true,
        "chart_present": false,
        "meeting_scene": false,
        "market_screen_present": false,
        "generic_broll_risk": 0.1
      }},
      "speaker": {{
        "speaker_name": "Tom Lee",
        "speaker_role": "analyst",
        "speaker_on_screen": true,
        "speaker_matchable": true
      }},
      "scores": {{
        "information_density": 8.2,
        "sentence_completeness": 8.7,
        "visual_usability": 8.3,
        "evidence_strength": 8.9,
        "entity_clarity": 9.1,
        "position_suitability": {{
          "opening": 8.0,
          "main": 9.1,
          "closing": 4.2
        }}
      }},
      "recommendation": {{
        "priority": "high",
        "recommended_roles": ["hook_evidence", "main_evidence"],
        "recommended_duration_sec": {{
          "min": 2.2,
          "ideal": 3.0,
          "max": 4.0
        }}
      }},
      "reason": "主体明确，观点清楚，画面就是原始证据。"
    }}
  ]
}}

请直接输出 JSON，不要有其他文字。
```
