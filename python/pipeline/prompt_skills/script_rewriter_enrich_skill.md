# Script Rewriter Enrichment Skill

## Stage 2 Prompt Template
```text
你现在处于第二阶段：**不要重写文案正文**，只给已有的 script_units 补齐结构化字段。

任务目标：
1. 保持每一段 `text` 原样不变。
2. 只为每段补 `content_intent` 和 `evidence`。
3. 输出必须是严格 JSON。

信息信任顺序（必须严格执行）：
1. 原帖标题与正文
2. 视频中可见文字（标题条、图表、字幕）
3. 视频画面摘要
4. 视频信息
5. 标签与话题词

硬约束：
1. 不要改写、删减、润色或重排 `text`。
2. 结构化字段必须服务于当前文案和当前素材，不能引入输入里没有的新人物、新机构、新资产、新技术术语。
3. `must_match.persons/orgs/assets/event_types/event_tags` 如果没有可靠信息，必须输出空数组 `[]`。
4. `evidence_types` 最多 3 个，`event_types` 最多 2 个。
5. `needs_visual_evidence`、`speaker_on_screen`、`ocr_preferred`、`direct_quote_preferred` 必须输出布尔值 `true/false`，不要输出字符串。
6. `source_priority` 只能从这些值里选一个：
   `video_transcript | onscreen_text | visual_summary | source_post | tags`
7. `claim_type` 只能从这些值里选一个：
   `fact_statement | speaker_quote_summary | market_judgment | policy_interpretation | data_interpretation | future_watchpoint`
8. `market_relevance` 只能从这些值里选一个：
   `high | medium | low`
9. `insert_priority` 只能从这些值里选一个：
   `high | medium | low | none`
10. `polarity` 只能从这些值里选一个：
    `bullish | bearish | neutral | mixed | na`

请严格按照以下结构输出 JSON：
{{
  "script_units": [
    {{
      "unit_id": 1,
      "content_intent": {{
        "claim_type": "<填入枚举值>",
        "core_claim": "一句话概括该段核心观点",
        "market_relevance": "<high | medium | low>",
        "needs_visual_evidence": true
      }},
      "evidence": {{
        "insert_priority": "<high | medium | low | none>",
        "source_priority": "<video_transcript | onscreen_text | visual_summary | source_post | tags>",
        "evidence_query": "一句自然语言查询，用于召回最匹配的证据片段",
        "evidence_types": ["<素材类型枚举，最多3个>"],
        "must_match": {{
          "persons": [],
          "orgs": [],
          "assets": [],
          "event_types": [],
          "event_tags": [],
          "polarity": "<bullish | bearish | neutral | mixed | na>"
        }},
        "preferred_match": {{
          "visual_types": ["<偏好画面类型>"],
          "speaker_on_screen": true,
          "ocr_preferred": true,
          "direct_quote_preferred": false
        }},
        "negative_constraints": {{
          "forbid_persons": [],
          "forbid_visual_types": [],
          "forbid_polarity": []
        }},
        "duration_hint": {{
          "min": 3,
          "ideal": 6,
          "max": 9
        }}
      }}
    }}
  ]
}}

【原帖信息】
{source_post_json}

【素材提纲】
{outline_json}

【转写片段】
{audio_json}

【已选素材摘要】
{segments_json}

【第一阶段已生成文案】
{script_units_json}
```
