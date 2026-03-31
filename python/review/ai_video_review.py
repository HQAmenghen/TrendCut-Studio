"""
AI视频审核脚本
使用 Gemini 2.5 Pro/Flash 进行多模态视频分析
"""

import sys
import json
import os
import re
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "python"))

from load_env import load_project_env
from llm_client import (
    create_llm_client,
    generate_content,
    get_llm_provider
)
from qwen_client import describe_qwen_runtime
from script_protocol import emit_error, emit_result, emit_stage, run_guarded

load_project_env(__file__)

DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"
DEFAULT_QWEN_MODEL = "qwen3-vl-flash"
DEFAULT_QWEN_TEXT_FALLBACK_MODEL = "qwen3.5-plus"
MIN_PASS_SCORE = 70


def get_default_model() -> str:
    """根据 LLM 提供商获取默认模型"""
    provider = get_llm_provider()
    if provider == "qwen":
        return os.getenv("QWEN_VL_MODEL", DEFAULT_QWEN_MODEL)
    else:
        return os.getenv("AI_REVIEW_GEMINI_MODEL", DEFAULT_GEMINI_MODEL)


def get_qwen_review_fallback_model(primary_model: str) -> str | None:
    provider = get_llm_provider()
    if provider != "qwen":
        return None
    fallback = os.getenv("QWEN_TEXT_MODEL", DEFAULT_QWEN_TEXT_FALLBACK_MODEL)
    if fallback and fallback != primary_model:
        return fallback
    return None


def is_qwen_access_denied(exc: Exception) -> bool:
    message = str(exc or "").lower()
    return "accessdenied" in message or "access denied" in message


def generate_review_json(client, *, prompt: str, model: str, video_data: dict | None = None) -> dict:
    contents = [prompt]
    if video_data:
        contents.append(video_data)

    models_to_try = [model]
    fallback_model = get_qwen_review_fallback_model(model)
    if fallback_model:
        models_to_try.append(fallback_model)

    last_error = None
    for index, candidate_model in enumerate(models_to_try):
        try:
            if index > 0:
                ulog(f"审核模型回退: {model} -> {candidate_model}")
            response = generate_content(
                client,
                model=candidate_model,
                contents=contents,
                response_mime_type="application/json"
            )
            return parse_json_text(response.text)
        except Exception as exc:
            last_error = exc
            if get_llm_provider() != "qwen" or not is_qwen_access_denied(exc) or index >= len(models_to_try) - 1:
                raise
            ulog(f"警告: 模型 {candidate_model} 命中访问限制，尝试使用备用模型继续审核: {exc}")

    if last_error:
        raise last_error
    raise RuntimeError("审核模型调用失败")


def parse_json_text(text: str) -> dict:
    """兼容解析纯 JSON、markdown fenced JSON，以及前后夹杂说明文本的返回"""
    payload = str(text or "").strip()
    if not payload:
        raise ValueError("模型返回为空，无法解析 JSON")

    fenced_match = re.search(r"```(?:json)?\s*(\{.*\}|\[.*\])\s*```", payload, re.DOTALL | re.IGNORECASE)
    if fenced_match:
        payload = fenced_match.group(1).strip()

    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        json_match = re.search(r"(\{.*\}|\[.*\])", payload, re.DOTALL)
        if json_match:
            return json.loads(json_match.group(1))
        raise


def ulog(msg: str):
    """统一日志输出"""
    print(f"AI_REVIEW|{msg}", flush=True)


def create_video_input(video_path: str) -> dict:
    """根据当前提供商构造视频输入"""
    provider = get_llm_provider()
    ext = os.path.splitext(video_path)[1].lower()
    mime_type_map = {
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.webm': 'video/webm'
    }
    mime_type = mime_type_map.get(ext, 'video/mp4')

    if provider == 'qwen':
        return {
            'local_path': str(Path(video_path).resolve()),
            'media_type': 'video',
            'mime_type': mime_type,
            'fps': 2,
        }

    import base64
    with open(video_path, 'rb') as f:
        video_data = f.read()
    return {
        'base64': base64.b64encode(video_data).decode('utf-8'),
        'mime_type': mime_type,
    }


def analyze_video_content(client, video_data: dict, metadata: dict, model: str) -> dict:
    """分析视频内容质量"""
    emit_stage("review.content", "正在分析视频内容质量")
    ulog("开始分析视频内容质量")

    title = metadata.get('suggestedTitle', metadata.get('title', ''))
    summary = metadata.get('sourceSummary', '')

    prompt = f"""你是专业的视频内容审核专家。请分析这个短视频的内容质量。

视频标题: {title}
内容摘要: {summary}

请从以下维度评估(0-100分):
1. 画面清晰度和稳定性 - 画面是否清晰、稳定、无抖动
2. 内容连贯性和逻辑性 - 内容是否连贯、逻辑清晰
3. 信息准确性和价值 - 信息是否准确、有价值
4. 视觉吸引力 - 画面是否吸引人

评分要求：
- 必须给出真实分数，不要为了稳妥把所有项都打成 85 左右。
- 各维度要拉开差异，有明显问题就降分，有明显优势就升分。
- 只有当视频确实整体优秀且各项接近时，才允许多个分数接近。
- 下面 JSON 里的数字仅用于展示字段格式，不是默认分数，也不能直接照抄。

请严格输出JSON格式:
{{
  "score": 0,
  "clarity": {{"score": 0, "comment": "画面清晰稳定"}},
  "coherence": {{"score": 0, "comment": "内容连贯"}},
  "accuracy": {{"score": 0, "comment": "信息准确"}},
  "appeal": {{"score": 0, "comment": "视觉吸引"}},
  "issues": ["问题1", "问题2"],
  "strengths": ["优点1", "优点2"]
}}
"""

    try:
        result = generate_review_json(
            client,
            prompt=prompt,
            model=model,
            video_data=video_data
        )
        ulog(f"内容质量分析完成，得分: {result.get('score', 0)}")
        return result
    except Exception as e:
        ulog(f"错误: 内容质量分析失败: {str(e)}")
        raise


def analyze_subtitle_accuracy(client, video_data: dict, subtitles: list, model: str) -> dict:
    """分析字幕准确性"""
    emit_stage("review.subtitle", "正在分析字幕准确性")
    ulog("开始分析字幕准确性")

    if not subtitles:
        ulog("警告: 没有字幕数据，字幕项将按兜底策略处理，整条视频审核会继续执行")
        return {
            "score": 100,
            "sync_accuracy": {"score": 100, "issues": []},
            "text_accuracy": {"score": 100, "errors": []},
            "punctuation": {"score": 100, "suggestions": []},
            "readability": {"score": 100, "timing_issues": []},
            "critical_issues": [],
            "minor_issues": []
        }

    # 构建字幕文本
    subtitle_lines = []
    for s in subtitles[:50]:  # 限制前50条字幕，避免prompt过长
        time_info = s.get('time', [0, 0])
        if isinstance(time_info, list) and len(time_info) >= 2:
            start, end = time_info[0], time_info[1]
        else:
            start = s.get('start', 0)
            end = s.get('end', 0)
        text = s.get('zh', s.get('text', ''))
        subtitle_lines.append(f"[{start:.2f}s - {end:.2f}s] {text}")

    subtitle_text = "\n".join(subtitle_lines)

    prompt = f"""你是专业的字幕审核专家。请对比视频音频和提供的字幕，评估字幕质量。

字幕内容:
{subtitle_text}

评估维度(0-100分):
1. 字幕与音频的同步准确性 - 时间轴是否准确
2. 文字识别准确率 - 文字是否正确
3. 标点符号和断句合理性 - 标点和断句是否合理
4. 字幕时长和可读性 - 显示时长是否合适

评分要求：
- 必须依据字幕内容真实打分，禁止把示例里的 85 当成固定答案。
- 如果存在错译、漏译、时间轴偏移、排版拥挤等问题，要明确扣分。
- 如果字幕质量明显很好，也可以高于 90。
- 下面 JSON 的数字只是字段占位，不是参考分。

请严格输出JSON格式:
{{
  "score": 0,
  "sync_accuracy": {{"score": 0, "issues": []}},
  "text_accuracy": {{"score": 0, "errors": ["错误1"]}},
  "punctuation": {{"score": 0, "suggestions": ["建议1"]}},
  "readability": {{"score": 0, "timing_issues": []}},
  "critical_issues": ["严重问题"],
  "minor_issues": ["轻微问题"]
}}
"""

    result = generate_review_json(
        client,
        prompt=prompt,
        model=model,
        video_data=video_data
    )
    ulog(f"字幕准确性分析完成，得分: {result.get('score', 0)}")
    return result


def analyze_title_appeal(title: str, summary: str, client, model: str) -> dict:
    """分析标题吸引力"""
    emit_stage("review.title", "正在分析标题吸引力")
    ulog("开始分析标题吸引力")

    if not title:
        ulog("警告: 没有标题，跳过标题分析")
        return {
            "score": 50,
            "relevance": {"score": 50, "comment": "缺少标题"},
            "appeal": {"score": 50, "comment": "缺少标题"},
            "keywords": {"score": 50, "comment": "缺少标题"},
            "readability": {"score": 50, "comment": "缺少标题"},
            "suggestions": ["请添加标题"],
            "alternative_titles": []
        }

    prompt = f"""你是专业的内容运营专家。请评估这个短视频标题的吸引力。

标题: {title}
内容摘要: {summary}

评估维度(0-100分):
1. 标题与内容的匹配度 - 标题是否准确反映内容
2. 标题的吸引力和点击欲望 - 是否能吸引用户点击
3. 关键词使用效果 - 关键词是否有效
4. 长度和可读性 - 长度是否合适、易读

评分要求：
- 请根据标题真实质量打分，不要机械返回 85。
- 标题很弱时可以打到 40-60，优秀时可以到 90+。
- 下面 JSON 中的数字仅用于示例格式，不是建议分数。

请严格输出JSON格式:
{{
  "score": 0,
  "relevance": {{"score": 0, "comment": "标题与内容匹配"}},
  "appeal": {{"score": 0, "comment": "吸引力中等"}},
  "keywords": {{"score": 0, "comment": "关键词有效"}},
  "readability": {{"score": 0, "comment": "长度合适"}},
  "suggestions": ["建议1", "建议2"],
  "alternative_titles": ["备选标题1", "备选标题2"]
}}
"""

    result = generate_review_json(
        client,
        prompt=prompt,
        model=model
    )
    ulog(f"标题吸引力分析完成，得分: {result.get('score', 0)}")
    return result


def analyze_editing_quality(client, video_data: dict, metadata: dict, model: str) -> dict:
    """分析剪辑质量"""
    emit_stage("review.editing", "正在分析剪辑质量")
    ulog("开始分析剪辑质量")

    prompt = f"""你是专业的视频剪辑审核专家。请评估这个短视频的剪辑质量。

评估维度(0-100分):
1. 转场流畅度 - 画面切换是否流畅自然
2. 节奏把控 - 视频节奏是否合适
3. 画面构图 - 构图是否美观
4. 音频质量 - 音频是否清晰、音量是否合适

评分要求：
- 请根据剪辑质量真实打分，不要把示例值当默认值。
- 如果几乎没有剪辑变化、字幕挤压、构图不佳、音频问题明显，要主动拉低分数。
- 如果节奏、构图、技术执行都很强，也可以明显高于 85。
- 下面 JSON 中的数字只是格式占位，不代表推荐分数。

请严格输出JSON格式:
{{
  "score": 0,
  "transitions": {{"score": 0, "issues": []}},
  "pacing": {{"score": 0, "comment": "节奏适中"}},
  "composition": {{"score": 0, "issues": []}},
  "audio": {{"score": 0, "issues": []}},
  "technical_issues": ["技术问题"],
  "creative_suggestions": ["创意建议"]
}}
"""

    result = generate_review_json(
        client,
        prompt=prompt,
        model=model,
        video_data=video_data
    )
    ulog(f"剪辑质量分析完成，得分: {result.get('score', 0)}")
    return result


def calculate_overall_score(scores: dict, weights: dict) -> int:
    """计算综合得分"""
    content_weight = weights.get('content', 30)
    subtitle_weight = weights.get('subtitle', 25)
    title_weight = weights.get('title', 20)
    editing_weight = weights.get('editing', 25)

    total = (
        scores['content'] * content_weight +
        scores['subtitle'] * subtitle_weight +
        scores['title'] * title_weight +
        scores['editing'] * editing_weight
    ) / 100

    return int(total)


def generate_fix_suggestions(analyses: dict, scores: dict, min_pass_score: int) -> list:
    """生成修复建议"""
    suggestions = []

    # 内容质量问题
    if scores['content'] < 70:
        for issue in analyses['content'].get('issues', []):
            suggestions.append({
                'category': 'content',
                'severity': 'high',
                'issue': issue,
                'suggestion': '请重新审视视频内容质量'
            })

    # 字幕问题
    subtitle_analysis = analyses['subtitle']
    if subtitle_analysis.get('critical_issues'):
        for issue in subtitle_analysis['critical_issues']:
            suggestions.append({
                'category': 'subtitle',
                'severity': 'high',
                'issue': issue,
                'suggestion': '需要修正字幕内容或时间轴'
            })

    if scores['subtitle'] < 80:
        for error in subtitle_analysis.get('text_accuracy', {}).get('errors', []):
            suggestions.append({
                'category': 'subtitle',
                'severity': 'medium',
                'issue': f'字幕识别错误: {error}',
                'suggestion': '重新运行ASR或手动修正字幕'
            })

    # 标题问题
    if scores['title'] < 70:
        title_analysis = analyses['title']
        for suggestion_text in title_analysis.get('suggestions', [])[:2]:
            suggestions.append({
                'category': 'title',
                'severity': 'medium',
                'issue': '标题吸引力可以提升',
                'suggestion': suggestion_text
            })

        # 提供备选标题
        alt_titles = title_analysis.get('alternative_titles', [])
        if alt_titles:
            suggestions.append({
                'category': 'title',
                'severity': 'low',
                'issue': '标题优化建议',
                'suggestion': f'可以尝试: {alt_titles[0]}'
            })

    # 剪辑问题
    editing_analysis = analyses['editing']
    if editing_analysis.get('technical_issues'):
        for issue in editing_analysis['technical_issues']:
            suggestions.append({
                'category': 'editing',
                'severity': 'high',
                'issue': issue,
                'suggestion': '需要重新剪辑视频'
            })

    return suggestions


def main():
    import argparse
    parser = argparse.ArgumentParser(description='AI视频审核脚本')
    parser.add_argument('--video', required=True, help='视频文件路径')
    parser.add_argument('--metadata', required=True, help='元数据JSON文件路径')
    parser.add_argument('--config', help='审核配置JSON文件路径')
    parser.add_argument('--output', default='review_result.json', help='输出结果文件')
    args = parser.parse_args()

    # 检查文件存在
    if not os.path.exists(args.video):
        emit_error("VIDEO_NOT_FOUND", f"视频文件不存在: {args.video}", "review.init")
        return 1

    if not os.path.exists(args.metadata):
        emit_error("METADATA_NOT_FOUND", f"元数据文件不存在: {args.metadata}", "review.init")
        return 1

    # 加载元数据
    try:
        with open(args.metadata, 'r', encoding='utf-8') as f:
            metadata = json.load(f)
    except Exception as e:
        emit_error("METADATA_READ_FAILED", f"读取元数据失败: {str(e)}", "review.init")
        return 1

    # 加载配置
    config = {
        'min_pass_score': MIN_PASS_SCORE,
        'weights': {
            'content': 30,
            'subtitle': 25,
            'title': 20,
            'editing': 25
        },
        'model': get_default_model()
    }

    ulog(f"使用模型: {config['model']} (LLM提供商: {get_llm_provider()})")

    if args.config and os.path.exists(args.config):
        try:
            with open(args.config, 'r', encoding='utf-8') as f:
                user_config = json.load(f)
                config.update(user_config)
        except Exception as e:
            ulog(f"警告: 读取配置文件失败，使用默认配置: {str(e)}")

    emit_stage("review.init", f"开始AI视频审核 (模型: {config['model']})")
    ulog(f"视频路径: {args.video}")
    ulog(f"最低通过分数: {config['min_pass_score']}")

    # 创建 LLM 客户端
    try:
        client = create_llm_client()
        if get_llm_provider() == 'qwen':
            ulog(describe_qwen_runtime(client))
    except Exception as e:
        emit_error("LLM_CLIENT_FAILED", f"创建 LLM 客户端失败: {str(e)}", "review.init")
        return 1

    # 检查视频文件大小
    video_size_mb = os.path.getsize(args.video) / (1024 * 1024)
    ulog(f"视频文件大小: {video_size_mb:.2f} MB")

    # Gemini 走 inline base64 时保留体积保护；Qwen 原生 file:// 不受这条限制
    if get_llm_provider() != 'qwen' and video_size_mb > 50:
        emit_error(
            "VIDEO_TOO_LARGE",
            f"视频文件过大 ({video_size_mb:.2f} MB)，超过 50MB 建议限制。\n提示: 请压缩视频或使用官方 Gemini API（支持更大文件）",
            "review.init"
        )
        return 1

    # 构造视频输入
    emit_stage("review.encode", "正在准备视频输入")

    try:
        if get_llm_provider() == 'qwen':
            ulog("正在准备 Qwen 原生本地视频输入...")
        else:
            ulog("正在将视频编码为 base64...")
        video_data = create_video_input(args.video)
        if get_llm_provider() == 'qwen':
            ulog(f"视频输入准备完成 (本地文件模式, MIME: {video_data['mime_type']})")
        else:
            ulog(f"视频编码完成 (MIME: {video_data['mime_type']})")
    except Exception as e:
        emit_error("VIDEO_ENCODE_FAILED", f"视频输入准备失败: {str(e)}", "review.encode")
        return 1

    try:
        # 执行各项分析
        model = config['model']

        content_analysis = analyze_video_content(client, video_data, metadata, model)
        subtitle_analysis = analyze_subtitle_accuracy(
            client, video_data, metadata.get('subtitles', []), model
        )
        title_analysis = analyze_title_appeal(
            metadata.get('suggestedTitle', metadata.get('title', '')),
            metadata.get('sourceSummary', ''),
            client,
            model
        )
        editing_analysis = analyze_editing_quality(client, video_data, metadata, model)

        # 计算综合得分
        scores = {
            'content': content_analysis['score'],
            'subtitle': subtitle_analysis['score'],
            'title': title_analysis['score'],
            'editing': editing_analysis['score']
        }

        overall_score = calculate_overall_score(scores, config.get('weights', {}))
        passed = overall_score >= config['min_pass_score']

        emit_stage("review.scoring", f"综合得分: {overall_score}/{config['min_pass_score']}")
        ulog(f"内容质量: {scores['content']}, 字幕准确性: {scores['subtitle']}, 标题吸引力: {scores['title']}, 剪辑质量: {scores['editing']}")

        # 生成修复建议
        fix_suggestions = generate_fix_suggestions(
            {
                'content': content_analysis,
                'subtitle': subtitle_analysis,
                'title': title_analysis,
                'editing': editing_analysis
            },
            scores,
            config['min_pass_score']
        )

        # 构建结果
        result = {
            'status': 'passed' if passed else 'failed',
            'overall_score': overall_score,
            'scores': scores,
            'content_analysis': content_analysis,
            'subtitle_analysis': subtitle_analysis,
            'title_analysis': title_analysis,
            'editing_analysis': editing_analysis,
            'fix_suggestions': fix_suggestions,
            'passed': passed,
            'reviewed_at': datetime.now().isoformat(),
            'config': config
        }

        # 保存结果
        try:
            with open(args.output, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            ulog(f"审核结果已保存到: {args.output}")
        except Exception as e:
            ulog(f"警告: 保存结果文件失败: {str(e)}")

        emit_result(
            f"审核完成 - {'✓ 通过' if passed else '✗ 未通过'}",
            overall_score=overall_score,
            passed=passed,
            result_file=args.output,
            fix_suggestions_count=len(fix_suggestions)
        )

        return 0 if passed else 0  # 即使未通过也返回0，让调用方处理

    except Exception as e:
        emit_error("REVIEW_ANALYSIS_FAILED", f"审核分析失败: {str(e)}", "review.analysis")
        return 1


if __name__ == "__main__":
    sys.exit(run_guarded(
        main,
        error_code="AI_REVIEW_FAILED",
        error_message="AI视频审核失败",
        error_stage="review",
        hint="请检查视频文件、元数据和Gemini API配置"
    ))
