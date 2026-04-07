"""
JSON 数据结构定义和字段说明
定义各 Agent 输入输出的数据格式
"""

# ============================================================================
# Script Plan Schema (script_plan.json)
# ============================================================================

SCRIPT_PLAN_SCHEMA = {
    "topic": "str - 视频主题",
    "angle": "str - 切入角度",
    "target_duration_sec": "int - 目标时长（秒）",
    "segments": [
        {
            "id": "str - 段落ID（如 hook, main1, main2, closing）",
            "goal": "str - 这一段的目标（如 吸引注意、传递核心信息、引导互动）",
            "summary": "str - 这一段要讲什么",
            "source_basis": "str - 信息来源（material: 纯素材, material_plus_post: 素材+补充）",
            "supporting_context": "str - 补充上下文（当 source_basis 为 material_plus_post 时使用）",
            "narration_needed": "bool - 是否需要数字人口播",
            "preferred_video_source": "str - 优先视频来源（material: 纯素材, mixed: 混合, avatar: 数字人）",
            "prefer_source_audio": "bool - 是否优先保留素材原声"
        }
    ]
}

SCRIPT_PLAN_EXAMPLE = {
    "topic": "万事达卡收购稳定币公司",
    "angle": "传统金融拥抱数字资产",
    "target_duration_sec": 45,
    "segments": [
        {
            "id": "hook",
            "goal": "快速吸引注意",
            "summary": "华尔街巨头正在加速进入数字资产领域",
            "source_basis": "material",
            "supporting_context": "",
            "narration_needed": True,
            "preferred_video_source": "mixed",
            "prefer_source_audio": False
        }
    ]
}


# ============================================================================
# Material Plan Schema (material_plan.json)
# ============================================================================

MATERIAL_PLAN_SCHEMA = {
    "material_duration_sec": "float - 素材总时长",
    "recommended_total_duration_sec": "int - 建议成片时长",
    "segments": [
        {
            "id": "str - 素材段ID（如 m1, m2）",
            "start": "float - 开始时间（秒）",
            "end": "float - 结束时间（秒）",
            "summary": "str - 这段素材的内容摘要",
            "has_strong_source_audio": "bool - 是否有高价值原声",
            "priority": "str - 优先级（high, medium, low）",
            "usage": "str - 建议用途（opening: 开场, main_fact_segment: 主信息段, transition: 过渡, closing: 收尾）"
        }
    ]
}

MATERIAL_PLAN_EXAMPLE = {
    "material_duration_sec": 63.0,
    "recommended_total_duration_sec": 45,
    "segments": [
        {
            "id": "m1",
            "start": 0.0,
            "end": 11.0,
            "summary": "主播播报万事达卡收购新闻",
            "has_strong_source_audio": True,
            "priority": "high",
            "usage": "opening"
        },
        {
            "id": "m2",
            "start": 25.0,
            "end": 57.0,
            "summary": "嘉宾分析传统支付巨头拥抱稳定币技术",
            "has_strong_source_audio": True,
            "priority": "high",
            "usage": "main_fact_segment"
        }
    ]
}


# ============================================================================
# Director Review Schema (director_review.json)
# ============================================================================

DIRECTOR_REVIEW_SCHEMA = {
    "passed": "bool - 是否通过质量检查",
    "issues": [
        {
            "code": "str - 问题代码（如 MATERIAL_RATIO_TOO_LOW）",
            "message": "str - 问题描述"
        }
    ],
    "suggestions": ["str - 改进建议"],
    "metrics": {
        "total_duration_sec": "float - 总时长",
        "material_video_ratio": "float - 素材视觉占比（0-1）",
        "avatar_video_ratio": "float - 数字人视觉占比（0-1）",
        "source_audio_ratio": "float - 素材原声占比（0-1）",
        "hard_cut_risk_count": "int - 硬切风险数量"
    }
}

# 问题代码定义
ISSUE_CODES = {
    "MATERIAL_RATIO_TOO_LOW": "素材视觉占比不足（建议 >= 0.6）",
    "AVATAR_RATIO_TOO_HIGH": "数字人视觉占比过高（建议 <= 0.4）",
    "DURATION_TOO_SHORT": "总时长过短",
    "DURATION_TOO_LONG": "总时长过长",
    "HARD_CUT_RISK": "存在话没说完就切镜头的风险",
    "SOURCE_AUDIO_TOO_SHORT": "素材原声片段过短（< 3秒）",
    "SHOT_TOO_SHORT": "存在过短镜头（< 2秒）",
    "AUDIO_SWITCH_TOO_FREQUENT": "音频切换过于频繁"
}

DIRECTOR_REVIEW_EXAMPLE = {
    "passed": False,
    "issues": [
        {
            "code": "MATERIAL_RATIO_TOO_LOW",
            "message": "素材视觉占比仅 36%，建议至少 60%"
        },
        {
            "code": "HARD_CUT_RISK",
            "message": "在 15.2s 处数字人话未说完就切换"
        }
    ],
    "suggestions": [
        "将 5.3s-15.0s 改为素材画面",
        "延长素材原声片段至少到 3 秒以上"
    ],
    "metrics": {
        "total_duration_sec": 31.4,
        "material_video_ratio": 0.36,
        "avatar_video_ratio": 0.64,
        "source_audio_ratio": 0.48,
        "hard_cut_risk_count": 3
    }
}


# ============================================================================
# 输入文件格式说明
# ============================================================================

# audio.json - 数字人音频轴
AUDIO_JSON_FORMAT = [
    {
        "start": "float - 开始时间（秒）",
        "end": "float - 结束时间（秒）",
        "text": "str - 口播文本"
    }
]

# subtitles.json - 字幕轴
SUBTITLES_JSON_FORMAT = [
    {
        "time": ["float - 开始时间", "float - 结束时间"],
        "zh": "str - 中文字幕",
        "en": "str - 英文字幕"
    }
]

# result.json - 素材视觉轴
RESULT_JSON_FORMAT = {
    "summary": "str - 素材整体摘要",
    "visual_timeline": [
        {
            "time": "str - 时间范围（如 00:00-00:02）",
            "action": "str - 画面描述"
        }
    ],
    "audio_transcript": [
        {
            "time": "str - 时间范围",
            "text": "str - 原声文本"
        }
    ]
}

# content_outline.json - 内容大纲（如果存在）
CONTENT_OUTLINE_FORMAT = {
    "title": "str - 标题",
    "summary": "str - 摘要",
    "key_points": ["str - 关键点"]
}
