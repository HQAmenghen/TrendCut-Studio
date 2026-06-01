"""Reference-text-authority subtitle alignment.

This module owns the LLM-driven path where the reference narration text is the
only accepted subtitle text source and ASR is used only for timing boundaries.
Callers inject subtitle/LLM helpers so this logic can stay independent from the
large ASR workflow module.
"""

from dataclasses import dataclass
import json
import os
from pathlib import Path
import time
from typing import Callable


class ReferenceAuthorityAlignmentError(RuntimeError):
    """Raised when reference-text-authority subtitles cannot be safely verified."""

    code = "REFERENCE_AUTHORITY_ALIGNMENT_FAILED"
    stage = "subtitle_reference_authority"
    message = "参考文本字幕时间轴未通过严格校验"
    hint = "系统会重试 ASR 与参考文本分配；如果持续失败，请检查口播稿是否对应最终成片音频。"

    def __init__(self, details):
        super().__init__(details)
        self.details = str(details or self.message)


@dataclass(frozen=True)
class ReferenceAuthorityDeps:
    resolve_split_config: Callable
    reference_authority_display_limit: Callable
    merge_reference_authority_micro_asr_fragments: Callable
    subtitle_time_range: Callable
    get_subtitle_primary_text: Callable
    apply_domain_corrections: Callable
    normalize_final_subtitles: Callable
    visible_text: Callable
    parse_json_array_from_text: Callable
    get_text_model_for_provider: Callable
    create_llm_client: Callable
    generate_content: Callable
    get_text_llm_provider: Callable
    emit_stage: Callable
    append_debug_event: Callable | None = None


def append_reference_authority_debug_event(event, debug_path=None):
    debug_path = Path(debug_path or "reference_authority_debug.json")
    try:
        existing = json.loads(debug_path.read_text(encoding="utf-8")) if debug_path.exists() else []
        if not isinstance(existing, list):
            existing = []
    except Exception:
        existing = []
    payload = dict(event or {})
    payload["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    existing.append(payload)
    debug_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")


def reference_authority_asr_debug_segments(asr_entries, deps):
    return [
        {
            "index": index,
            "time": list(deps.subtitle_time_range(entry) or []),
            "asr_text": deps.get_subtitle_primary_text(entry),
        }
        for index, entry in enumerate(asr_entries or [])
    ]


def reference_authority_retry_count():
    raw_value = os.getenv("REFERENCE_AUTHORITY_LLM_RETRIES")
    if raw_value is None or str(raw_value).strip() == "":
        return 5
    try:
        return max(1, int(raw_value))
    except (TypeError, ValueError):
        return 5


def build_reference_authority_prompt(
    asr_entries,
    reference_text,
    deps,
    source_language="",
    split_config=None,
    retry_index=0,
    failure_reason="",
):
    split_config = deps.resolve_split_config(split_config)
    reference = str(reference_text or "").strip()
    display_limit = deps.reference_authority_display_limit(reference, split_config)
    target_min = max(8, min(14, display_limit - 10))
    target_max = max(target_min, min(22, display_limit - 2))
    normalized_asr_entries = deps.merge_reference_authority_micro_asr_fragments(asr_entries)
    payload = {
        "source_language": source_language or "auto",
        "reference_text": reference,
        "asr_segments": [
            {
                "index": index,
                "time": list(deps.subtitle_time_range(entry) or []),
                "asr_text": deps.get_subtitle_primary_text(entry),
            }
            for index, entry in enumerate(normalized_asr_entries)
        ],
    }
    retry_instruction = ""
    if retry_index > 0:
        retry_instruction = (
            f"这是第 {retry_index + 1} 次尝试。上一轮失败原因：{failure_reason or '输出不是可解析的字幕 JSON'}。"
            "这次必须直接输出可解析的最终字幕 JSON 数组。"
        )

    return (
        "你是字幕时间轴与阅读分组助手。任务是直接输出最终可渲染字幕 JSON。"
        "最高优先级：reference_text 是唯一文本来源和最终口播稿，ASR 只用于判断时间边界、停顿和语义位置。"
        "最终输出的 zh 必须只由 reference_text 中按顺序出现的连续原文子串组成。"
        "严禁翻译、润色、同义替换、概括、补词、删词、改标点含义，严禁把 ASR 文本写进 zh。"
        "如果 ASR 与 reference_text 冲突，必须无条件相信 reference_text；数字、金额、单位、专有名词必须完整照抄。"
        "例如 reference_text 写 750,000到1,250,000美元，就必须完整保留这一段，不能改成 750000~，也不能漏掉 1,250,000美元。"
        "例如 reference_text 写 顶部的想象，就必须输出 顶部的想象，不能改成 顶部的预期。"
        "不要按时长比例机械分配；要参考每条 asr_text 的语义、停顿和相邻句段给每条 zh 填入 time。"
        f"竖屏画面只有两行中文字幕区域，这是硬约束：每个显示字幕组最多 {display_limit} 个可见中文字符，"
        f"推荐 {target_min}-{target_max} 个可见字符。宁可多输出几条短字幕，也绝不能输出超长字幕。"
        "如果一个句子超过上限，你必须沿 ASR 时间边界或自然分句拆成多条。"
        "不要把多个完整句子、多个逗号分句、或一整段口播合并成一条字幕。"
        "每个显示字幕组避免以标点开头，避免把固定短语拆开。"
        "必须保护数字、金额、百分比、ticker 和专有名词，禁止把 7.5%、2%-3%、$BMNR、1000万 这类 token 从中间拆开。"
        "直接输出最终字幕 JSON 数组；每项必须包含 time 和 zh，可选 en。"
        "time 必须是 [start,end] 秒，start/end 参考 asr_segments 的时间轴，整体顺序递增且覆盖口播。"
        "zh 必须逐字复制 reference_text 的连续原文片段；所有 zh 拼接后必须完整等于 reference_text。"
        "只输出 JSON，不要 markdown。\n\n"
        f"{retry_instruction}\n"
        f"输入：{json.dumps(payload, ensure_ascii=False)}"
    )


def parse_direct_reference_authority_subtitles(results, reference_text, deps):
    if not str(reference_text or "").strip() or not isinstance(results, list):
        return []

    output = []
    for item in results:
        if not isinstance(item, dict):
            return []
        time_range = deps.subtitle_time_range(item)
        if not time_range:
            return []
        text = deps.apply_domain_corrections(str(item.get("zh") or item.get("text") or "").strip())
        if not text:
            return []
        entry = {
            "time": [time_range[0], time_range[1]],
            "zh": text,
            "text": text,
        }
        if str(item.get("en") or "").strip():
            entry["en"] = str(item.get("en") or "").strip()
        output.append(entry)

    return deps.normalize_final_subtitles(output)


def validate_direct_reference_authority_subtitles(results, reference_text, deps):
    reference = deps.apply_domain_corrections(str(reference_text or "").strip())
    subtitles = parse_direct_reference_authority_subtitles(results, reference, deps)
    if not subtitles:
        return []

    joined = "".join(item["zh"] for item in subtitles)
    if deps.visible_text(joined) != deps.visible_text(reference):
        return []

    previous_end = None
    for item in subtitles:
        time_range = deps.subtitle_time_range(item)
        if not time_range:
            return []
        start, end = time_range
        if previous_end is not None and start < previous_end - 0.03:
            return []
        previous_end = end

    return subtitles


def align_reference_authority_with_llm(
    asr_entries,
    reference_text,
    deps,
    source_language="",
    split_config=None,
    strict=False,
):
    reference = deps.apply_domain_corrections(str(reference_text or "").strip())
    normalized_asr_entries = deps.merge_reference_authority_micro_asr_fragments(asr_entries)
    if len(normalized_asr_entries or []) <= 1 or not reference:
        return []

    max_attempts = reference_authority_retry_count() if strict else 1
    provider = None
    client = None
    model = None
    last_error = ""
    append_debug_event = deps.append_debug_event or append_reference_authority_debug_event
    for attempt in range(max_attempts):
        attempt_error = ""
        try:
            deps.emit_stage(
                "subtitle_reference_authority",
                f"正在让大模型直接输出参考口播稿字幕（第 {attempt + 1}/{max_attempts} 次）",
            )
            if client is None:
                provider = deps.get_text_llm_provider()
                client = deps.create_llm_client(provider=provider)
                model = deps.get_text_model_for_provider(provider)
            prompt = build_reference_authority_prompt(
                normalized_asr_entries,
                reference,
                deps,
                source_language=source_language,
                split_config=split_config,
                retry_index=attempt,
                failure_reason=last_error,
            )
            response = deps.generate_content(
                client,
                model=model,
                contents=prompt,
                response_mime_type="application/json",
                provider=provider,
            )
            results = deps.parse_json_array_from_text(getattr(response, "text", response))
            validated = validate_direct_reference_authority_subtitles(results, reference, deps)
            if not validated:
                attempt_error = "模型未按原稿输出可用最终字幕 JSON"
            if not validated and strict and attempt + 1 < max_attempts:
                last_error = attempt_error or "参考文本权威分配未返回可用 JSON"
                print(f"   ⚠️ {last_error}，准备重试。")
                time.sleep(min(1.5, 0.4 * (attempt + 1)))
                continue
            if not validated:
                append_debug_event({
                    "attempt": attempt + 1,
                    "max_attempts": max_attempts,
                    "reason": attempt_error or "unknown_validation_failure",
                    "reference_text": reference,
                    "asr_segments": reference_authority_asr_debug_segments(normalized_asr_entries, deps),
                    "llm_results": results,
                })
            if validated:
                if attempt > 0:
                    print(f"   ✅ 参考文本权威分配重试成功: 第 {attempt + 1} 次")
                return validated
            last_error = attempt_error or "参考文本权威分配未返回可用 JSON"
            print(f"   ⚠️ {last_error}，准备重试。" if attempt + 1 < max_attempts else f"   ⚠️ {last_error}。")
        except Exception as err:
            last_error = str(err)
            if attempt + 1 < max_attempts:
                print(f"   ⚠️ 参考文本权威分配失败，准备重试: {err}")
                time.sleep(min(1.5, 0.4 * (attempt + 1)))
                continue
            if strict:
                raise ReferenceAuthorityAlignmentError(f"参考文本权威分配失败: {err}") from err
            print(f"   ⚠️ 参考文本权威分配失败: {err}")
            return []

    if strict:
        raise ReferenceAuthorityAlignmentError(last_error or "参考文本权威分配未返回可用 JSON")
    print("   ⚠️ 参考文本权威分配未返回可用 JSON。")
    return []


def build_reference_authority_subtitles(
    asr_subtitles,
    reference_subtitles,
    deps,
    split_config=None,
    source_language="",
    use_llm=True,
    strict=False,
):
    """Ask the LLM for final subtitles while keeping reference text as the only text source."""

    if not reference_subtitles:
        return asr_subtitles

    asr_entries = deps.normalize_final_subtitles(asr_subtitles)
    if not asr_entries:
        if strict:
            raise ReferenceAuthorityAlignmentError("参考文本权威模式未获得可验证 ASR 句段")
        return deps.normalize_final_subtitles(reference_subtitles)

    reference_entries = sorted(
        [entry for entry in reference_subtitles if deps.subtitle_time_range(entry)],
        key=lambda item: deps.subtitle_time_range(item)[0],
    )
    reference_text = "".join(deps.get_subtitle_primary_text(entry) for entry in reference_entries).strip()
    if not reference_text:
        if strict:
            raise ReferenceAuthorityAlignmentError("参考文本权威模式未获得参考口播稿")
        return deps.normalize_final_subtitles(reference_subtitles)

    if not use_llm:
        return deps.normalize_final_subtitles(reference_entries)

    try:
        output = align_reference_authority_with_llm(
            asr_entries,
            reference_text,
            deps,
            source_language=source_language,
            split_config=split_config,
            strict=strict,
        )
    except ReferenceAuthorityAlignmentError:
        raise

    if not output and strict:
        raise ReferenceAuthorityAlignmentError("参考文本权威分配未返回可用 JSON")
    if not output:
        return []
    print(f"   ✅ 已按 ASR 句段时间轴套用参考文本权威字幕: {len(output)} 条")
    return output
