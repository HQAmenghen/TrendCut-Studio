"""
LLM-based narration rewriting skill.
"""

import json
import os
import re
from typing import Any, Dict, List

from llm_client import create_llm_client, generate_content, get_text_llm_provider

from .base import BaseSkill, SkillResult
from .prompt_skill_loader import load_prompt_text


DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"
DEFAULT_VERTEX_MODEL = "gemini-3-pro-preview"
DEFAULT_QWEN_MODEL = "qwen3.6-plus"
DEFAULT_QWEN_SCRIPT_TEXT_MODEL = "qwen3.6-plus"
DEFAULT_QWEN_SCRIPT_ENRICH_MODEL = "qwen3.6-plus"
DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro"

AI_TRANSITION_TEMPLATE_PATTERNS = [
    re.compile(r"((?:这可|这并|这)?不是[^。！？!?]{0,24}?而是[^。！？!?]{0,36})"),
    re.compile(r"(不再(?:仅仅是|只是|是)?[^。！？!?]{0,24}?而是[^。！？!?]{0,36})"),
]

AI_TRANSITION_EMPTY_SHELL_PATTERNS = [
    re.compile(r"(?:^|[，,。；;!?！？\s])(?:这可|这并|这)?不是[，,；; ]*而是[，,；; ]*(?=[。！？!?]|$)"),
    re.compile(r"(?:^|[，,。；;!?！？\s])不再(?:仅仅是|只是|是)?[，,；; ]*而是[，,；; ]*(?=[。！？!?]|$)"),
]

AI_CLICHE_PHRASES = [
    "综上所述", "总而言之", "值得深思", "底层逻辑",
    "应该注意的是", "值得注意的是", "需要指出的是",
    "毫无疑问", "一般来说", "不可否认", "众所周知",
]

AI_SEQUENTIAL_PATTERN = re.compile(
    r"(?:^|(?<=[，,。；;!?！？\s]))"
    r"(?:首先[，,：:；;].*?其次[，,：:；;]|"
    r"第一[，,：:；;].*?第二[，,：:；;])"
)

AI_PASSIVE_PATTERN = re.compile(
    r"(?:被认为|被发现|被广泛接受|被视为|被公认)"
)

SEMANTIC_CUE_GROUPS = {
    "blackrock": ["blackrock", "贝莱德"],
    "fox business": ["fox business", "fox", "福克斯商业", "福克斯"],
    "portfolio": ["portfolio", "investment portfolio", "投资组合", "组合"],
    "value": ["value", "valuable", "价值"],
    "rules": ["rules", "own rules", "自身规则", "规则"],
    "driven": ["driven", "driven by", "驱动", "受自身规则驱动"],
    "coinbase": ["coinbase", "coinbase ceo", "coinbase首席执行官"],
    "fox": ["fox", "fox business", "福克斯", "福克斯商业"],
    "g20": ["g20", "g 20", "g-20", "g20国家", "g20 国家", "二十国集团", "20国集团"],
    "strategic reserve": ["strategic reserve", "strategic", "reserve", "reserves", "战略储备", "战略比特币储备", "储备", "储备资产"],
    "establish": ["establish", "established", "establishing", "建立", "设立", "创建"],
    "soon": ["soon", "很快", "即将", "马上", "不久"],
    "bullish": ["bullish", "看涨", "看多", "利好", "偏多"],
    "nation": ["nation", "nations", "国家", "各国"],
    "all": ["all", "所有", "全部", "各个"],
    "live": ["live", "直播", "现场"],
    "futuristic": ["futuristic", "future", "未来主义", "未来感", "未来"],
    "crypto": ["crypto", "cryptocurrency", "加密", "加密货币", "数字资产", "虚拟资产"],
    "payments": ["payment", "payments", "pay", "支付", "消费", "刷卡"],
    "holographic": ["holographic", "hologram", "全息", "半透明", "透明"],
    "card": ["card", "cards", "卡", "卡片"],
    "wallet": ["wallet", "wallets", "钱包"],
    "balance": ["balance", "balances", "余额"],
    "transaction": ["transaction", "transactions", "交易", "交易摘要", "交易完成"],
    "bitcoin": ["bitcoin", "btc", "比特币"],
    "solana": ["solana", "sol", "索拉纳"],
    "laferrari": ["laferrari", "ferrari", "法拉利", "拉法"],
    "print world": ["print world", "printworld", "打印世界"],
    "months": ["month", "months", "月", "个月"],
    "best": ["best", "最佳", "最好"],
    "lives": ["life", "lives", "人生"],
    "retail": ["retail", "散户"],
    "chasing": ["chasing", "chase", "追逐", "追涨"],
    "rally": ["rally", "rallies", "涨势", "反弹", "上涨"],
    "multiples": ["multiple", "multiples", "倍数", "估值倍数"],
    "expanding": ["expand", "expanding", "扩张"],
    "earnings": ["earning", "earnings", "盈利", "业绩"],
    "growth": ["growth", "增长"],
}


def _get_script_provider() -> str:
    """口播稿专用 provider：优先读 SCRIPT_LLM_PROVIDER，否则走全局"""
    return os.getenv("SCRIPT_LLM_PROVIDER", "").strip().lower() or get_text_llm_provider()


def get_text_model() -> str:
    provider = _get_script_provider()
    if provider == "vertex":
        return os.getenv("VERTEX_SCRIPT_MODEL") or os.getenv("GEMINI_MODEL") or DEFAULT_VERTEX_MODEL
    if provider == "qwen":
        return os.getenv("QWEN_TEXT_MODEL", DEFAULT_QWEN_MODEL)
    if provider == "deepseek":
        return os.getenv("DEEPSEEK_TEXT_MODEL", DEFAULT_DEEPSEEK_MODEL)
    return os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)


def get_text_stage_model() -> str:
    provider = _get_script_provider()
    if provider == "vertex":
        return os.getenv("VERTEX_SCRIPT_MODEL") or os.getenv("GEMINI_MODEL") or DEFAULT_VERTEX_MODEL
    if provider == "qwen":
        return (
            os.getenv("QWEN_SCRIPT_TEXT_MODEL")
            or os.getenv("QWEN_TEXT_MODEL")
            or DEFAULT_QWEN_SCRIPT_TEXT_MODEL
        )
    if provider == "deepseek":
        return os.getenv("DEEPSEEK_TEXT_MODEL", DEFAULT_DEEPSEEK_MODEL)
    return os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)


def get_enrich_stage_model() -> str:
    provider = _get_script_provider()
    if provider == "vertex":
        return os.getenv("VERTEX_SCRIPT_MODEL") or os.getenv("GEMINI_MODEL") or DEFAULT_VERTEX_MODEL
    if provider == "qwen":
        return (
            os.getenv("QWEN_SCRIPT_ENRICH_MODEL")
            or os.getenv("QWEN_SCORING_MODEL")
            or "qwen3.6-plus"
            or DEFAULT_QWEN_SCRIPT_ENRICH_MODEL
        )
    if provider == "deepseek":
        return os.getenv("DEEPSEEK_TEXT_MODEL", DEFAULT_DEEPSEEK_MODEL)
    return os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)


class ScriptRewriterSkill(BaseSkill):
    name = "script_rewriter_skill"

    REWRITE_TEXT_PROMPT = load_prompt_text("script_rewriter_skill.md", "Stage 1 Prompt Template")
    ENRICH_PROMPT = load_prompt_text("script_rewriter_enrich_skill.md", "Stage 2 Prompt Template")
    COMBINED_PROMPT = load_prompt_text("script_rewriter_combined_skill.md", "Combined Prompt Template")

    def _extract_json(self, text: str) -> Dict[str, Any]:
        try:
            return json.loads(text)
        except Exception:
            pass
        fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", str(text or ""), re.DOTALL)
        if fenced:
            return json.loads(fenced.group(1))
        match = re.search(r"\{.*\}", str(text or ""), re.DOTALL)
        if match:
            return json.loads(match.group(0))
        raise ValueError("无法从 ScriptRewriterSkill 响应中提取 JSON")

    def _normalize_outline(self, outline: Dict[str, Any]) -> List[Dict[str, Any]]:
        items = []
        for segment in outline.get("segments") or []:
            text = str(segment.get("summary") or segment.get("goal") or "").strip()
            if not text:
                continue
            items.append({
                "id": segment.get("id"),
                "text": text,
                "start_time": segment.get("start_time"),
                "end_time": segment.get("end_time"),
            })
        return items[:8]

    def _normalize_audio(self, audio_items: Any) -> List[Dict[str, Any]]:
        if not isinstance(audio_items, list):
            return []
        normalized = []
        for item in audio_items[:12]:
            text = str(item.get("text") or "").strip()
            if not text:
                continue
            normalized.append({
                "start": item.get("start"),
                "end": item.get("end"),
                "text": text,
            })
        return normalized

    def _normalize_selected_segments(self, payload: Any) -> List[Dict[str, Any]]:
        if isinstance(payload, dict):
            payload = payload.get("segments") or []
        if not isinstance(payload, list):
            return []
        normalized = []
        for item in payload[:6]:
            normalized.append({
                "id": item.get("id"),
                "text": item.get("text") or item.get("summary") or "",
                "reason": item.get("reason") or "",
                "duration_sec": item.get("duration_sec"),
            })
        return normalized

    def _normalize_source_post(self, payload: Any) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            return {}
        title = str(payload.get("title") or "").strip()
        body = str(payload.get("body") or "").strip()
        post_url = str(payload.get("postUrl") or "").strip()
        material_url = str(payload.get("materialUrl") or "").strip()
        return {
            "title": title,
            "body": body,
            "post_url": post_url,
            "material_url": material_url,
        }

    def _tokenize(self, text: str) -> List[str]:
        cleaned = re.sub(r"[^\w\u4e00-\u9fff%.,+-]+", " ", str(text or "").lower())
        raw_parts = [item.strip() for item in cleaned.split() if item.strip()]
        tokens: List[str] = []
        seen = set()
        stopwords = {
            "视频", "内容", "表示", "认为", "这个", "那个", "一种", "以及", "正在", "有关", "相关",
            "about", "with", "that", "this", "from", "into", "using", "used", "will", "they", "them",
            "say", "says", "said", "tells", "tell", "telling", "provides", "provide", "provided",
            "the", "next", "could", "be", "of", "our", "on", "by", "its", "and",
        }
        for part in raw_parts:
            if part in stopwords:
                continue
            candidates = [part]
            if re.search(r"[a-z]", part):
                candidates.extend(re.findall(r"[a-z]+", part))
            if re.search(r"\d", part):
                candidates.extend(re.findall(r"\d[\d,]*(?:\.\d+)?%?", part))
            for item in candidates:
                value = str(item or "").strip().lower()
                if len(value) < 2 and not re.search(r"\d", value):
                    continue
                if value in stopwords or value in seen:
                    continue
                seen.add(value)
                tokens.append(value)
        return tokens

    def _clean_source_fact_text(self, text: str) -> str:
        cleaned = re.sub(r"\s+", " ", str(text or "")).strip()
        cleaned = re.sub(r"^[^\w\u4e00-\u9fff%$+-]+", "", cleaned)
        cleaned = re.sub(r"[^\w\u4e00-\u9fff%$+-]+$", "", cleaned)
        return cleaned.strip(" ，,。；;：:-—")

    def _append_fact_cue(
        self,
        facts: List[Dict[str, Any]],
        seen: set,
        canonical: str,
        aliases: List[str] | None = None,
        cue_type: str = "source_phrase",
    ) -> None:
        canonical_text = self._clean_source_fact_text(canonical)
        if not canonical_text:
            return
        compact = re.sub(r"\s+", "", canonical_text.lower())
        if len(compact) < 4 and not re.search(r"\d", compact):
            return
        if compact in seen:
            return
        normalized_aliases = []
        alias_seen = {canonical_text.lower()}
        for alias in aliases or []:
            alias_text = self._clean_source_fact_text(alias)
            if not alias_text:
                continue
            alias_key = alias_text.lower()
            if alias_key in alias_seen:
                continue
            alias_seen.add(alias_key)
            normalized_aliases.append(alias_text)
        seen.add(compact)
        facts.append({
            "type": cue_type,
            "canonical": canonical_text,
            "aliases": normalized_aliases,
        })

    def _extract_source_fact_cues(self, raw_text: str) -> List[Dict[str, Any]]:
        facts: List[Dict[str, Any]] = []
        seen = set()
        raw = str(raw_text or "")

        for line in re.split(r"[\r\n]+", raw):
            if not re.search(r"[\u4e00-\u9fff]", line):
                continue
            for sentence in re.split(r"[。！？!?；;]+", line):
                sentence = self._clean_source_fact_text(sentence)
                if not sentence:
                    continue
                pieces = [self._clean_source_fact_text(part) for part in re.split(r"[，,、]+", sentence)]
                for piece in pieces:
                    if not piece or not re.search(r"[\u4e00-\u9fff]", piece):
                        continue
                    compact = re.sub(r"\s+", "", piece)
                    if 4 <= len(compact) <= 48:
                        self._append_fact_cue(facts, seen, piece, cue_type="source_phrase")
                sentence_compact = re.sub(r"\s+", "", sentence)
                if 4 <= len(sentence_compact) <= 64:
                    self._append_fact_cue(facts, seen, sentence, cue_type="source_phrase")

        raw_lower = raw.lower()
        if len(facts) < 3:
            for canonical, variants in SEMANTIC_CUE_GROUPS.items():
                if any(str(variant).lower() in raw_lower for variant in variants):
                    self._append_fact_cue(
                        facts,
                        seen,
                        canonical,
                        aliases=variants,
                        cue_type="semantic_concept",
                    )

        if len(facts) < 3:
            for match in re.finditer(
                r"(?<![a-z])(?:[A-Z][A-Za-z0-9&.'-]+)(?:\s+(?:[A-Z][A-Za-z0-9&.'-]+)){0,4}",
                raw,
            ):
                self._append_fact_cue(facts, seen, match.group(0), cue_type="named_entity")

        return facts[:12]

    def _extract_source_focus(self, source_post_info: Dict[str, Any]) -> Dict[str, Any]:
        title = str(source_post_info.get("title") or "").strip()
        body = str(source_post_info.get("body") or "").strip()
        raw_text = "\n".join(part for part in [title, body] if part).strip()
        raw_text_lower = raw_text.lower()
        numeric_cues = []
        seen_numbers = set()
        for item in re.findall(r"\d[\d,]*(?:\.\d+)?%?|\d+(?:\.\d+)?万(?:美元|美金|u)?|\d+(?:\.\d+)?(?:美元|美金|u)", raw_text):
            token = str(item or "").strip()
            if token and token not in seen_numbers:
                seen_numbers.add(token)
                numeric_cues.append(token)

        keyword_cues = []
        seen_keywords = set()
        candidates = re.findall(
            r"#[A-Za-z0-9._+-]+|[A-Z]{2,}[A-Z0-9._+-]*|比特币|bitcoin|btc|ai|机器人|程序员|交易|预测|胜率|利润|黄金|标普(?:500)?|期货|15分钟|上涨|下跌",
            raw_text,
        )
        for item in self._tokenize(" ".join(candidates or [raw_text])):
            if item in seen_keywords:
                continue
            seen_keywords.add(item)
            keyword_cues.append(item)
        for canonical, variants in SEMANTIC_CUE_GROUPS.items():
            if canonical in seen_keywords:
                continue
            if any(str(variant).lower() in raw_text_lower for variant in variants):
                seen_keywords.add(canonical)
                keyword_cues.append(canonical)

        priority_order = [
            "程序员", "ai", "机器人", "bot", "比特币", "bitcoin", "btc",
            "交易", "预测", "15分钟", "上涨", "下跌", "胜率", "利润",
        ]
        priority_cues: List[str] = []
        seen_priority = set()
        for item in numeric_cues:
            value = str(item or "").strip()
            if not value or value in seen_priority:
                continue
            seen_priority.add(value)
            priority_cues.append(value)
        for item in priority_order:
            if item in seen_priority:
                continue
            if self._text_contains_priority_cue(raw_text, item):
                seen_priority.add(item)
                priority_cues.append(item)

        anchor_text = "；".join([
            f"标题: {title}" if title else "",
            f"正文: {body}" if body else "",
        ]).strip("；")
        return {
            "has_source_anchor": bool(raw_text),
            "anchor_text": anchor_text,
            "fact_cues": self._extract_source_fact_cues(raw_text),
            "numeric_cues": numeric_cues[:10],
            "keyword_cues": keyword_cues[:16],
            "priority_cues": priority_cues[:12],
            "focus_hint": (
                "原帖为空，无法提供发帖者主张锚点，只能依据视频内容重写。"
                if not raw_text
                else "优先吸收原帖里的结果、收益、胜率、交易次数、时间窗口、方法名称和目标资产。"
            ),
        }

    def _text_contains_priority_cue(self, text: str, cue: str) -> bool:
        raw_text = str(text or "")
        raw_cue = str(cue or "").strip()
        if not raw_text or not raw_cue:
            return False
        if re.search(r"[a-z]", raw_cue, re.IGNORECASE):
            return bool(re.search(rf"(?<![a-z0-9]){re.escape(raw_cue.lower())}(?![a-z0-9])", raw_text.lower()))
        return raw_cue in raw_text

    def _expand_cue_variants(self, cue: str) -> List[str]:
        normalized = str(cue or "").strip().lower()
        if not normalized:
            return []
        variants = [normalized]
        seen = {normalized}
        normalized_compact = re.sub(r"\s+", "", normalized)
        for canonical, group in SEMANTIC_CUE_GROUPS.items():
            group_values = [str(item or "").strip().lower() for item in group if str(item or "").strip()]
            compact_values = {re.sub(r"\s+", "", item) for item in group_values}
            if normalized == canonical or normalized in group_values or normalized_compact in compact_values:
                for item in [canonical, *group_values]:
                    if item and item not in seen:
                        seen.add(item)
                        variants.append(item)
                break
        return variants

    def _cue_matches_script(self, cue: str, script_text: str, script_tokens: set) -> bool:
        variants = self._expand_cue_variants(cue)
        if not variants:
            return False
        normalized_script = script_text.lower()
        normalized_script_compact = re.sub(r"[\s,，]", "", normalized_script)
        for variant in variants:
            normalized_variant_compact = re.sub(r"[\s,，]", "", variant)
            if variant in normalized_script or normalized_variant_compact in normalized_script_compact:
                return True
            cue_tokens = set(self._tokenize(variant)) or {variant}
            if cue_tokens & script_tokens:
                return True
        return False

    def _fact_matches_script(self, fact: Dict[str, Any], script_text: str, script_tokens: set) -> bool:
        candidates = [fact.get("canonical"), *(fact.get("aliases") or [])]
        for candidate in candidates:
            if self._cue_matches_script(str(candidate or ""), script_text, script_tokens):
                return True
        return False

    def _script_source_coverage(self, script_units: List[Dict[str, Any]], source_focus: Dict[str, Any]) -> Dict[str, Any]:
        if not source_focus.get("has_source_anchor"):
            return {
                "has_source_anchor": False,
                "coverage_ratio": 1.0,
                "fact_coverage_ratio": 1.0,
                "fact_total": 0,
                "priority_coverage_ratio": 1.0,
                "numeric_match_count": 0,
                "numeric_total": 0,
                "missing_cues": [],
                "matched_cues": [],
                "missing_facts": [],
                "matched_facts": [],
                "missing_priority_cues": [],
                "matched_priority_cues": [],
            }

        script_text = " ".join(str(item.get("text") or "").strip() for item in script_units if str(item.get("text") or "").strip())
        script_tokens = set(self._tokenize(script_text))
        fact_cues = [item for item in (source_focus.get("fact_cues") or []) if isinstance(item, dict)]
        matched_facts = []
        missing_facts = []
        for fact in fact_cues[:12]:
            canonical = str(fact.get("canonical") or "").strip()
            if self._fact_matches_script(fact, script_text, script_tokens):
                matched_facts.append(canonical)
            else:
                missing_facts.append(canonical)
        source_cues = []
        for item in source_focus.get("numeric_cues") or []:
            source_cues.append(str(item).lower())
        for item in source_focus.get("keyword_cues") or []:
            if item not in source_cues:
                source_cues.append(str(item).lower())
        source_cues = source_cues[:18]
        matched = []
        missing = []
        for cue in source_cues:
            if self._cue_matches_script(cue, script_text, script_tokens):
                matched.append(cue)
            else:
                missing.append(cue)
        priority_cues = [str(item).lower() for item in (source_focus.get("priority_cues") or []) if str(item).strip()]
        matched_priority = []
        missing_priority = []
        for cue in priority_cues:
            if self._cue_matches_script(cue, script_text, script_tokens):
                matched_priority.append(cue)
            else:
                missing_priority.append(cue)
        numeric_cues = [str(item).lower() for item in (source_focus.get("numeric_cues") or []) if str(item).strip()]
        numeric_match_count = sum(1 for cue in numeric_cues if self._cue_matches_script(cue, script_text, script_tokens))
        ratio = (len(matched) / len(source_cues)) if source_cues else 1.0
        fact_ratio = (len(matched_facts) / len(fact_cues[:12])) if fact_cues else 1.0
        priority_ratio = (len(matched_priority) / len(priority_cues)) if priority_cues else 1.0
        return {
            "has_source_anchor": True,
            "coverage_ratio": round(ratio, 4),
            "fact_coverage_ratio": round(fact_ratio, 4),
            "fact_total": len(fact_cues[:12]),
            "priority_coverage_ratio": round(priority_ratio, 4),
            "numeric_match_count": numeric_match_count,
            "numeric_total": len(numeric_cues),
            "matched_cues": matched,
            "missing_cues": missing[:10],
            "matched_facts": matched_facts,
            "missing_facts": missing_facts[:10],
            "matched_priority_cues": matched_priority,
            "missing_priority_cues": missing_priority[:10],
        }

    def _coverage_score(self, coverage: Dict[str, Any]) -> float:
        return (
            float(coverage.get("coverage_ratio", 0.0))
            + 1.2 * float(coverage.get("priority_coverage_ratio", 0.0))
            + 0.25 * float(coverage.get("numeric_match_count", 0))
        )

    def _needs_source_repair(self, source_focus: Dict[str, Any], coverage: Dict[str, Any]) -> bool:
        if not source_focus.get("has_source_anchor"):
            return False
        coverage_ratio = float(coverage.get("coverage_ratio", 1.0))
        fact_total = int(coverage.get("fact_total", 0) or 0)
        fact_ratio = float(coverage.get("fact_coverage_ratio", 1.0))
        priority_ratio = float(coverage.get("priority_coverage_ratio", 1.0))
        numeric_total = int(coverage.get("numeric_total", 0) or 0)
        numeric_match_count = int(coverage.get("numeric_match_count", 0) or 0)
        if numeric_total >= 3 and numeric_match_count < 2:
            return True
        if numeric_total >= 1 and numeric_match_count == 0:
            return True
        if priority_ratio < 0.45:
            return True
        if fact_total:
            required_fact_ratio = 0.50 if fact_total <= 3 else 0.40
            return fact_ratio < required_fact_ratio
        if coverage_ratio < 0.40:
            priority_anchor_satisfied = priority_ratio >= 0.99 and (
                numeric_total == 0 or numeric_match_count > 0
            )
            if priority_anchor_satisfied and coverage_ratio >= 0.35:
                return False
            return True
        return False

    def _build_repair_prompt(
        self,
        base_prompt: str,
        source_focus: Dict[str, Any],
        coverage: Dict[str, Any],
        current_units: List[Dict[str, Any]],
        out_of_scope_terms: List[str] | None = None,
        style_violations: List[str] | None = None,
    ) -> str:
        current_text = [str(item.get("text") or "").strip() for item in current_units if str(item.get("text") or "").strip()]
        extra_constraints: List[str] = []
        next_rule_number = 10
        if out_of_scope_terms:
            extra_constraints.append(
                f"{next_rule_number}. 当前输出出现了不属于本任务上下文的术语: {json.dumps(out_of_scope_terms, ensure_ascii=False)}。"
                " 重写时必须彻底移除这些术语，除非它们能被当前原帖、画面文字或转写直接证实。\n"
            )
            next_rule_number += 1
        if style_violations:
            extra_constraints.append(
                f"{next_rule_number}. 当前输出出现了 AI 模板化强转折句式: {json.dumps(style_violations, ensure_ascii=False)}。"
                " 重写时必须改成直接陈述，严禁继续使用“这不是……而是……”“这可不是……而是……”“不再……而是……”这类对比模板。\n"
            )
            next_rule_number += 1
        return (
            f"{base_prompt}\n\n"
            "上一版输出存在明确问题：口播更像在概括视频结构，没有充分吸收原帖真正想强调的主张。\n"
            f"原帖锚点: {json.dumps(source_focus, ensure_ascii=False, indent=2)}\n"
            f"当前输出缺失的原帖线索: {json.dumps(coverage.get('missing_cues') or [], ensure_ascii=False)}\n"
            f"上一版口播: {json.dumps(current_text, ensure_ascii=False)}\n"
            "重写要求（必须全部满足）：\n"
            "1. hook 必须先交代原帖在强调什么结果、收益、方法、胜率、交易次数、时间窗口或核心主张。\n"
            "2. explain 段必须把视频里实际展示的内容，和原帖强调的结果建立联系。\n"
            "3. 不能只写‘展示了一笔交易’‘介绍了一种方法’这种泛句，必须让观众听完就知道原帖为什么会传播。\n"
            "4. 如果原帖锚点里有数字、收益、胜率、交易次数、时间窗口，至少覆盖其中两项；若视频无法证实，要改写成‘原帖强调的是……，视频里主要展示的是……’。\n"
            f"5. 原帖里的关键数字优先直接保留阿拉伯数字。当前原帖锚点里的关键数字是: {json.dumps(source_focus.get('numeric_cues') or [], ensure_ascii=False)}。不要把这些数字替换成别的样本里的数字，也不要全部改写成模糊数量词，更不能改动数量级。\n"
            "6. 严禁复用提示词示例、历史任务或其他贴文里的主体、资产、时间窗口、收益、胜率、交易次数。所有实体和数字只能来自当前输入。\n"
            "7. 如果原帖强调的是方向判断、涨跌预测或价格目标，正文里必须明确出现对应的时间窗口或方向信息，不能只写成抽象方法论。\n"
            "8. 如果当前原帖并不涉及交易战绩、胜率、量化系统、市场微观结构、高频执行，就严禁写出这些叙事或术语。\n"
            "9. 不要用‘原帖称’‘原帖热传’‘发帖者强调’这类元叙事开头，直接进入信息本身。\n"
            f"{''.join(extra_constraints)}"
            f"{next_rule_number}. 只输出 JSON，不要解释。"
        )

    def _build_context_blob(
        self,
        source_post_info: Dict[str, Any],
        outline_items: List[Dict[str, Any]],
        audio_snippets: List[Dict[str, Any]],
        segment_items: List[Dict[str, Any]],
    ) -> str:
        parts: List[str] = [
            str(source_post_info.get("title") or ""),
            str(source_post_info.get("body") or ""),
        ]
        for item in outline_items or []:
            parts.extend([
                str(item.get("summary") or ""),
                str(item.get("goal") or ""),
                str(item.get("supporting_context") or ""),
            ])
        for item in audio_snippets or []:
            parts.append(str(item.get("text") or ""))
        for item in segment_items or []:
            parts.extend([
                str(item.get("text") or ""),
                str(item.get("summary") or ""),
                str(item.get("reason") or ""),
            ])
        return " ".join(part for part in parts if part).lower()

    def _detect_out_of_scope_phrases(self, script_units: List[Dict[str, Any]], context_blob: str) -> List[str]:
        generated = " ".join(str(item.get("text") or "") for item in (script_units or [])).lower()
        if not generated:
            return []
        suspicious_terms = {
            "硬核交易员": ["硬核交易员"],
            "市场微观结构": ["市场微观结构"],
            "深层数据": ["深层数据"],
            "概率游戏": ["概率游戏"],
            "毫秒级执行": ["毫秒", "毫秒级"],
            "高频交易": ["高频交易", "高频"],
            "订单流": ["订单流"],
            "胜率": ["胜率"],
            "融资": ["融资"],
            "领投": ["领投"],
            "模型训练": ["模型训练", "训练"],
            "算力": ["算力"],
            "初创公司": ["初创公司"],
            "人工智能": ["人工智能", "ai"],
            "硬件基建": ["硬件基建", "硬件", "基建"],
            "供应链": ["供应链"],
        }
        flagged: List[str] = []
        for phrase, cues in suspicious_terms.items():
            if phrase.lower() in generated and not any(cue.lower() in context_blob for cue in cues):
                flagged.append(phrase)
        return flagged

    def is_script_context_compatible(
        self,
        script_units: List[Dict[str, Any]],
        source_post: Dict[str, Any] | None = None,
        outline: Dict[str, Any] | None = None,
        audio: List[Dict[str, Any]] | None = None,
        selected_segments: List[Dict[str, Any]] | None = None,
    ) -> bool:
        normalized_units = [
            item for item in (script_units or [])
            if str(item.get("text") or "").strip()
        ]
        if not normalized_units:
            return False

        source_post_info = self._normalize_source_post(source_post or {})
        outline_items = self._normalize_outline(outline or {})
        audio_snippets = self._normalize_audio(audio or [])
        segment_items = self._normalize_selected_segments(selected_segments or [])
        source_focus = self._extract_source_focus(source_post_info)
        context_blob = self._build_context_blob(
            source_post_info=source_post_info,
            outline_items=outline_items,
            audio_snippets=audio_snippets,
            segment_items=segment_items,
        )
        coverage = self._script_source_coverage(normalized_units, source_focus)
        if self._needs_source_repair(source_focus, coverage):
            return False
        if self._detect_out_of_scope_phrases(normalized_units, context_blob):
            return False
        if self._detect_ai_transition_templates(normalized_units):
            return False
        if self._detect_ai_cliche_phrases(normalized_units):
            return False
        return True

    def _detect_ai_transition_templates(self, script_units: List[Dict[str, Any]]) -> List[str]:
        flagged: List[str] = []
        seen = set()
        for item in script_units or []:
            text = str(item.get("text") or "").strip()
            if not text:
                continue
            for pattern in AI_TRANSITION_TEMPLATE_PATTERNS:
                for match in pattern.finditer(text):
                    phrase = str(match.group(1) or "").strip("，。； ")
                    if not phrase:
                        continue
                    if phrase in seen:
                        continue
                    seen.add(phrase)
                    flagged.append(phrase)
        return flagged

    def _detect_ai_cliche_phrases(self, script_units: List[Dict[str, Any]]) -> List[str]:
        flagged: List[str] = []
        seen = set()
        for item in script_units or []:
            text = str(item.get("text") or "").strip()
            if not text:
                continue
            for phrase in AI_CLICHE_PHRASES:
                if phrase in text and phrase not in seen:
                    seen.add(phrase)
                    flagged.append(phrase)
            if AI_SEQUENTIAL_PATTERN.search(text) and "sequential" not in seen:
                seen.add("sequential")
                flagged.append("首先/其次序列连接词")
        return flagged

    def _strip_ai_cliche_phrases(self, text: str) -> str:
        cleaned = str(text or "")
        for phrase in AI_CLICHE_PHRASES:
            cleaned = cleaned.replace(phrase, "")
        cleaned = re.sub(r"^(?:首先|其次|再次|最后|第一|第二|第三|第四)[，,：:；;。\s]*", "", cleaned)
        passive_replacements = [
            ("被认为", ""),
            ("被发现", ""),
            ("被广泛接受", "广泛接受"),
            ("被视为", ""),
            ("被公认", "公认"),
        ]
        for old, new in passive_replacements:
            cleaned = cleaned.replace(old, new)
        cleaned = re.sub(r"(?:[，,；;]\s*){2,}", "，", cleaned)
        cleaned = re.sub(r"(?:[。！？!?]\s*){2,}", "。", cleaned)
        cleaned = re.sub(r"[，,；;]\s*[。！？!?]", "。", cleaned)
        return cleaned.strip("，。； ")

    def _strip_empty_ai_transition_shells(self, text: str) -> str:
        cleaned = str(text or "")
        for pattern in AI_TRANSITION_EMPTY_SHELL_PATTERNS:
            cleaned = pattern.sub(" ", cleaned)
        cleaned = re.sub(r"(?:[，,；;]\s*){2,}", "，", cleaned)
        cleaned = re.sub(r"(?:[。！？!?]\s*){2,}", "。", cleaned)
        cleaned = re.sub(r"[，,；;]\s*[。！？!?]", "。", cleaned)
        return cleaned.strip()

    def _can_accept_repair(
        self,
        original_coverage: Dict[str, Any],
        repaired_coverage: Dict[str, Any],
        source_repair_required: bool,
        repair_out_of_scope_terms: List[str],
        repair_style_violations: List[str],
    ) -> bool:
        if repair_out_of_scope_terms or repair_style_violations:
            return False
        if source_repair_required:
            return self._coverage_score(repaired_coverage) >= self._coverage_score(original_coverage)
        return True

    def _strip_out_of_scope_phrases(self, script_units: List[Dict[str, Any]], flagged_terms: List[str]) -> List[Dict[str, Any]]:
        replacements = {
            "硬核交易员": "这位人物",
            "市场微观结构": "市场流动性",
            "深层数据": "盘面数据",
            "概率游戏": "市场博弈",
            "毫秒级执行": "快速执行",
            "高频交易": "高频执行",
            "订单流": "盘面流动",
            "胜率": "表现",
        }
        if not flagged_terms:
            return script_units
        flagged_set = set(flagged_terms)
        cleaned_units: List[Dict[str, Any]] = []
        for item in script_units or []:
            next_item = dict(item)
            text = str(next_item.get("text") or "")
            for term in flagged_set:
                replacement = replacements.get(term, "")
                text = text.replace(term, replacement)
            next_item["text"] = re.sub(r"\s{2,}", " ", text).strip("，。； ")
            cleaned_units.append(next_item)
        return cleaned_units

    def _sanitize_unit_text(self, text: str) -> str:
        cleaned = " ".join(str(text or "").split()).strip()
        cleaned = re.sub(r"^(好吧各位|好了各位|来试一试|看看会发生什么)[，,。！!\s]*", "", cleaned)
        cleaned = re.sub(r"^(这到底意味着什么|这背后到底意味着什么)[？?！!\s]*", "", cleaned)
        cleaned = re.sub(r"^(原帖称|原帖热传|原帖显示|发帖者强调(?:的是)?|帖子里说|这条帖子讲的是)[，,。:：\s]*", "", cleaned)
        cleaned = re.sub(r"(?:^|(?<=[，。；,.!?！？\s]))(原帖称|原帖热传|原帖显示|发帖者强调(?:的是)?|帖子里说|这条帖子讲的是)[，,。:：\s]*", " ", cleaned)
        cleaned = self._strip_empty_ai_transition_shells(cleaned)
        cleaned = self._strip_ai_cliche_phrases(cleaned)
        cleaned = " ".join(cleaned.split())
        cleaned = cleaned.strip("，。； ")
        return cleaned

    def _soften_compliance_risks(self, text: str, role: str) -> str:
        cleaned = str(text or "").strip()
        replacements = [
            (r"自动收割", "自动套利"),
            (r"提款机", "高效验算场"),
            (r"降维打击", "效率优势"),
            (r"割韭菜", "过度营销"),
            (r"暴富神话", "高收益叙事"),
            (r"暴富", "高收益"),
            (r"躺赚", "被动收益"),
            (r"稳赚", "提高胜率"),
            (r"稳赚不赔", "并非没有风险"),
        ]
        for pattern, replacement in replacements:
            cleaned = re.sub(pattern, replacement, cleaned)
        cleaned = re.sub(r"[！!]{2,}", "！", cleaned)
        if role != "hook":
            cleaned = cleaned.replace("！", "。").replace("!", "。")
        cleaned = re.sub(r"[。]{2,}", "。", cleaned)
        cleaned = re.sub(r"[，,]{2,}", "，", cleaned)
        return cleaned.strip()

    def _blur_repeated_precise_counts(self, units: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        seen_counts = set()
        pattern = re.compile(r"(?P<num>\d{1,3}(?:,\d{3})+|\d{4,})\s*(?P<unit>笔|次)")

        def _approx_phrase(raw_num: str, unit: str) -> str:
            digits = re.sub(r"[,\s]", "", raw_num)
            try:
                value = int(digits)
            except Exception:
                return f"{raw_num}{unit}"
            if value >= 10000:
                approx = max(1, round(value / 10000))
                return f"近{approx}万{unit}"
            if value >= 1000:
                approx = max(1, round(value / 1000))
                return f"超{approx}千{unit}"
            return f"{raw_num}{unit}"

        for item in units:
            text = str(item.get("text") or "")
            if not text:
                continue

            def _replace(match: re.Match[str]) -> str:
                number_key = re.sub(r"[,\s]", "", match.group("num"))
                key = f"{number_key}{match.group('unit')}"
                if key not in seen_counts:
                    seen_counts.add(key)
                    return match.group(0)
                return _approx_phrase(match.group("num"), match.group("unit"))

            item["text"] = pattern.sub(_replace, text)
        return units

    def _infer_sentence_type(self, role: str) -> str:
        if role == "hook":
            return "结论句"
        if role == "ending":
            return "收束句"
        return "分析句"

    def _infer_editing_hint(self, role: str) -> str:
        if role == "hook":
            return "适合大字幕重点强调，可先人像直出，再接新闻素材。"
        if role == "ending":
            return "适合人像收束，并用一句大字幕点出后续观察点。"
        return "前半句适合切新闻素材，后半句适合回到人像解释。"

    def _normalize_role(self, role: Any, index: int, total: int) -> str:
        normalized = str(role or "").strip().lower()
        if normalized in {"hook", "explain", "ending"}:
            return normalized
        if index == 1:
            return "hook"
        if index == total:
            return "ending"
        return "explain"

    def _normalize_string_list(self, value: Any) -> List[str]:
        if value is None:
            return []
        if isinstance(value, str):
            value = [value]
        if not isinstance(value, list):
            return []
        normalized: List[str] = []
        seen = set()
        for item in value:
            text = str(item or "").strip()
            if not text:
                continue
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(text)
        return normalized

    def _normalize_named_entities(self, value: Any, with_alias: bool = False) -> List[Dict[str, Any]]:
        if value is None:
            return []
        if not isinstance(value, list):
            value = [value]
        normalized: List[Dict[str, Any]] = []
        seen = set()
        for item in value:
            if isinstance(item, dict):
                name = str(item.get("name") or "").strip()
                if not name:
                    continue
                entity = {
                    "name": name,
                    "confidence": round(float(item.get("confidence", 0.8) or 0.8), 2),
                    "source": self._normalize_string_list(item.get("source") or ["llm_derived"]),
                }
                if with_alias:
                    entity["alias"] = self._normalize_string_list(item.get("alias"))
            else:
                name = str(item or "").strip()
                if not name:
                    continue
                entity = {
                    "name": name,
                    "confidence": 0.8,
                    "source": ["llm_derived"],
                }
                if with_alias:
                    entity["alias"] = []
            key = entity["name"].lower()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(entity)
        return normalized

    def _infer_claim_type(self, role: str) -> str:
        if role == "hook":
            return "market_judgment"
        if role == "ending":
            return "future_watchpoint"
        return "speaker_quote_summary"

    def _infer_insert_priority(self, role: str) -> str:
        if role == "hook":
            return "high"
        if role == "ending":
            return "low"
        return "medium"

    def _infer_event_types(self, role: str) -> List[str]:
        if role == "hook":
            return ["speaker_commentary", "market_reaction"]
        if role == "ending":
            return ["macro_commentary"]
        return ["speaker_commentary"]

    def _infer_evidence_types(self, role: str) -> List[str]:
        if role == "hook":
            return ["speaker_quote", "title_card"]
        if role == "ending":
            return ["title_card", "chart_data"]
        return ["speaker_quote", "news_proof"]

    def _infer_visual_types(self, role: str) -> List[str]:
        if role == "hook":
            return ["speaker_quote", "interview", "news_lower_third"]
        if role == "ending":
            return ["chart_data", "news_lower_third"]
        return ["speaker_quote", "interview", "news_lower_third", "chart_data"]

    def _guess_polarity(self, text: str) -> str:
        lowered = str(text or "").lower()
        bullish_tokens = ["看多", "上涨", "利好", "增持", "突破", "走强", "bullish", "upside", "target"]
        bearish_tokens = ["看空", "下跌", "利空", "减持", "承压", "走弱", "bearish", "downside", "selloff"]
        bullish = sum(1 for token in bullish_tokens if token in lowered)
        bearish = sum(1 for token in bearish_tokens if token in lowered)
        if bullish > bearish and bullish > 0:
            return "bullish"
        if bearish > bullish and bearish > 0:
            return "bearish"
        return "na"

    def _normalize_duration_hint(self, value: Any, role: str) -> Dict[str, float]:
        default_map = {
            "hook": (2.2, 2.8, 3.6),
            "ending": (1.6, 2.2, 3.0),
        }
        default_min, default_ideal, default_max = default_map.get(role, (1.8, 2.5, 3.4))
        hard_cap_map = {
            "hook": (2.0, 3.0, 3.8),
            "ending": (1.6, 2.4, 3.0),
        }
        hard_min, hard_ideal, hard_max = hard_cap_map.get(role, (1.8, 2.8, 3.6))
        if not isinstance(value, dict):
            return {"min": default_min, "ideal": default_ideal, "max": default_max}
        try:
            min_value = float(value.get("min", default_min) or default_min)
            ideal_value = float(value.get("ideal", default_ideal) or default_ideal)
            max_value = float(value.get("max", default_max) or default_max)
        except Exception:
            return {"min": default_min, "ideal": default_ideal, "max": default_max}
        min_value = min(max(1.2, min_value), hard_min)
        ideal_value = min(max(min_value, ideal_value), hard_ideal)
        max_value = min(max(ideal_value, max_value), hard_max)
        return {
            "min": round(min_value, 2),
            "ideal": round(ideal_value, 2),
            "max": round(max_value, 2),
        }

    def _normalize_content_intent(self, value: Any, role: str, text: str) -> Dict[str, Any]:
        if not isinstance(value, dict):
            value = {}
        market_relevance = str(value.get("market_relevance") or ("high" if role == "hook" else "medium")).strip().lower()
        if market_relevance not in {"high", "medium", "low"}:
            market_relevance = "medium"
        claim_type = str(value.get("claim_type") or self._infer_claim_type(role)).strip()
        return {
            "claim_type": claim_type,
            "core_claim": str(value.get("core_claim") or text).strip(),
            "market_relevance": market_relevance,
            "needs_visual_evidence": bool(value.get("needs_visual_evidence", role != "ending")),
        }

    def _normalize_evidence(self, value: Any, role: str, text: str) -> Dict[str, Any]:
        if not isinstance(value, dict):
            value = {}
        must_match = value.get("must_match") if isinstance(value.get("must_match"), dict) else {}
        preferred_match = value.get("preferred_match") if isinstance(value.get("preferred_match"), dict) else {}
        negative_constraints = (
            value.get("negative_constraints")
            if isinstance(value.get("negative_constraints"), dict)
            else {}
        )
        polarity = str(must_match.get("polarity") or self._guess_polarity(text)).strip().lower() or "na"
        if polarity not in {"bullish", "bearish", "neutral", "mixed", "na"}:
            polarity = "na"
        return {
            "insert_priority": str(value.get("insert_priority") or self._infer_insert_priority(role)).strip().lower(),
            "source_priority": str(value.get("source_priority") or "").strip(),
            "evidence_query": str(value.get("evidence_query") or text).strip(),
            "evidence_types": self._normalize_string_list(value.get("evidence_types") or self._infer_evidence_types(role)),
            "must_match": {
                "persons": self._normalize_string_list(must_match.get("persons")),
                "orgs": self._normalize_string_list(must_match.get("orgs")),
                "assets": self._normalize_string_list(must_match.get("assets")),
                "event_types": self._normalize_string_list(must_match.get("event_types") or self._infer_event_types(role)),
                "event_tags": self._normalize_string_list(must_match.get("event_tags")),
                "polarity": polarity,
            },
            "preferred_match": {
                "visual_types": self._normalize_string_list(preferred_match.get("visual_types") or self._infer_visual_types(role)),
                "speaker_on_screen": bool(preferred_match.get("speaker_on_screen", role != "ending")),
                "ocr_preferred": bool(preferred_match.get("ocr_preferred", role != "ending")),
                "direct_quote_preferred": bool(preferred_match.get("direct_quote_preferred", role != "ending")),
            },
            "negative_constraints": {
                "forbid_persons": self._normalize_string_list(negative_constraints.get("forbid_persons")),
                "forbid_visual_types": self._normalize_string_list(negative_constraints.get("forbid_visual_types") or ["generic_broll"]),
                "forbid_polarity": self._normalize_string_list(negative_constraints.get("forbid_polarity")),
            },
            "duration_hint": self._normalize_duration_hint(value.get("duration_hint"), role),
        }

    def _normalize_text_units(self, units: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        total = len(units)
        for index, item in enumerate(units, start=1):
            if isinstance(item, list):
                dict_candidates = [entry for entry in item if isinstance(entry, dict)]
                if len(dict_candidates) == 1:
                    item = dict_candidates[0]
                else:
                    continue
            elif not isinstance(item, dict):
                continue
            role = self._normalize_role(item.get("role"), index, total)
            text = self._sanitize_unit_text(item.get("text") or "")
            if not text:
                continue
            text = self._soften_compliance_risks(text, role)
            normalized.append({
                "id": item.get("id") or (f"script_{int(item.get('unit_id')):03d}" if str(item.get("unit_id") or "").isdigit() else f"script_{index:03d}"),
                "unit_id": index,
                "role": role,
                "text": text,
                "audio_mode": "voiceover",
                "subtitle_mode": "follow_global",
                "sentence_type": self._infer_sentence_type(role),
                "editing_hint": self._infer_editing_hint(role),
            })
        if len(normalized) >= 2:
            normalized[0]["role"] = "hook"
            normalized[-1]["role"] = "ending"
        return self._blur_repeated_precise_counts(normalized)

    def _merge_enrichment(self, text_units: List[Dict[str, Any]], enrich_units: List[Dict[str, Any]] | None) -> List[Dict[str, Any]]:
        enrich_units = enrich_units or []
        by_id: Dict[str, Dict[str, Any]] = {}
        by_unit_id: Dict[int, Dict[str, Any]] = {}
        for item in enrich_units:
            if not isinstance(item, dict):
                continue
            item_id = str(item.get("id") or "").strip()
            if item_id:
                by_id[item_id] = item
            unit_id_raw = item.get("unit_id")
            try:
                unit_id = int(unit_id_raw)
            except Exception:
                unit_id = None
            if unit_id:
                by_unit_id[unit_id] = item

        merged: List[Dict[str, Any]] = []
        total = len(text_units)
        for index, unit in enumerate(text_units, start=1):
            role = self._normalize_role(unit.get("role"), index, total)
            enrich = by_id.get(str(unit.get("id") or "").strip()) or by_unit_id.get(index) or {}
            text = str(unit.get("text") or "").strip()
            merged.append({
                "id": unit.get("id") or f"script_{index:03d}",
                "unit_id": index,
                "role": role,
                "text": text,
                "audio_mode": unit.get("audio_mode") or "voiceover",
                "subtitle_mode": unit.get("subtitle_mode") or "follow_global",
                "sentence_type": unit.get("sentence_type") or self._infer_sentence_type(role),
                "editing_hint": unit.get("editing_hint") or self._infer_editing_hint(role),
                "content_intent": self._normalize_content_intent(enrich.get("content_intent"), role, text),
                "evidence": self._normalize_evidence(enrich.get("evidence"), role, text),
            })
        if len(merged) >= 2:
            merged[0]["role"] = "hook"
            merged[-1]["role"] = "ending"
            merged[0]["content_intent"] = self._normalize_content_intent(merged[0].get("content_intent"), "hook", merged[0]["text"])
            merged[0]["evidence"] = self._normalize_evidence(merged[0].get("evidence"), "hook", merged[0]["text"])
            merged[-1]["content_intent"] = self._normalize_content_intent(merged[-1].get("content_intent"), "ending", merged[-1]["text"])
            merged[-1]["evidence"] = self._normalize_evidence(merged[-1].get("evidence"), "ending", merged[-1]["text"])
        return merged

    def _extract_script_unit_items(self, payload: Any) -> List[Dict[str, Any]]:
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            if isinstance(payload.get("script_units"), list):
                return payload.get("script_units") or []
            data = payload.get("data")
            if isinstance(data, dict) and isinstance(data.get("script_units"), list):
                return data.get("script_units") or []
        return []

    def _build_compact_text_prompt(
        self,
        source_post_info: Dict[str, Any],
        outline_items: List[Dict[str, Any]],
        audio_snippets: List[Dict[str, Any]],
        segment_items: List[Dict[str, Any]],
        route: Dict[str, Any],
        outline: Dict[str, Any],
    ) -> str:
        compact_outline = outline_items[:4]
        compact_audio = audio_snippets[:4]
        compact_segments = segment_items[:4]
        return (
            "你现在只做一件事：根据当前贴文和视频信息，写出 3 到 4 段适合数字人播报的口播正文。\n"
            "要求：\n"
            "1. 必须围绕当前贴文主题，不能套用量化交易、硬核交易员等无关模板。\n"
            "2. 第一段必须先落原帖里最关键的结果锚点。\n"
            "3. 只输出 JSON，不要解释。\n"
            "4. 只输出 unit_id、role、text 三个字段。\n"
            "5. role 只能是 hook / explain / ending。\n"
            "6. 文案要顺口、可播报，有连接感，不要碎句堆砌。\n\n"
            "输出格式：\n"
            "{\n"
            '  "script_units": [\n'
            '    {"unit_id": 1, "role": "hook", "text": "..."},\n'
            '    {"unit_id": 2, "role": "explain", "text": "..."}\n'
            "  ]\n"
            "}\n\n"
            f"内容类型：{str(route.get('content_type') or 'fast_news')}\n"
            f"目标时长：{str(route.get('duration_target') or outline.get('target_duration_sec') or 45)} 秒\n\n"
            f"【原帖信息】\n{json.dumps(source_post_info, ensure_ascii=False, indent=2)}\n\n"
            f"【素材提纲】\n{json.dumps(compact_outline, ensure_ascii=False, indent=2)}\n\n"
            f"【转写片段】\n{json.dumps(compact_audio, ensure_ascii=False, indent=2)}\n\n"
            f"【已选素材摘要】\n{json.dumps(compact_segments, ensure_ascii=False, indent=2)}"
        )

    def _run_combined(
        self,
        client: Any,
        model: str,
        provider: str,
        source_post_info: Dict[str, Any],
        source_focus: Dict[str, Any],
        outline_items: List[Dict[str, Any]],
        audio_snippets: List[Dict[str, Any]],
        segment_items: List[Dict[str, Any]],
        route: Dict[str, Any],
        outline: Dict[str, Any],
        context_blob: str,
    ) -> SkillResult | None:
        """尝试合并单次 LLM 调用生成 text + content_intent + evidence。
        成功返回 SkillResult，失败返回 None（由调用方 fallback 到两阶段模式）。
        """
        try:
            combined_prompt = self.COMBINED_PROMPT.format(
                content_type=str(route.get("content_type") or "fast_news"),
                duration_target=str(route.get("duration_target") or outline.get("target_duration_sec") or 45),
                outline_json=json.dumps(outline_items, ensure_ascii=False, indent=2),
                audio_json=json.dumps(audio_snippets, ensure_ascii=False, indent=2),
                segments_json=json.dumps(segment_items, ensure_ascii=False, indent=2),
                source_post_json=json.dumps(source_post_info, ensure_ascii=False, indent=2),
                source_focus_json=json.dumps(source_focus, ensure_ascii=False, indent=2),
            )
            response = generate_content(
                client,
                model=model,
                contents=combined_prompt,
                response_mime_type="application/json",
                retries=2,
                request_timeout=180,
            )
            data = self._extract_json(response.text)
            raw_units = self._extract_script_unit_items(data)
            text_units = self._normalize_text_units(raw_units)
            if not text_units:
                return None

            coverage = self._script_source_coverage(text_units, source_focus)
            out_of_scope_terms = self._detect_out_of_scope_phrases(text_units, context_blob)
            style_violations = self._detect_ai_transition_templates(text_units) + self._detect_ai_cliche_phrases(text_units)
            source_repair_required = self._needs_source_repair(source_focus, coverage)
            text_repaired = False

            needs_repair = source_repair_required or bool(out_of_scope_terms) or bool(style_violations)
            if needs_repair:
                repair_prompt = self._build_repair_prompt(
                    base_prompt=combined_prompt,
                    source_focus=source_focus,
                    coverage=coverage,
                    current_units=text_units,
                    out_of_scope_terms=out_of_scope_terms or None,
                    style_violations=style_violations or None,
                )
                try:
                    repair_response = generate_content(
                        client,
                        model=model,
                        contents=repair_prompt,
                        response_mime_type="application/json",
                        retries=1,
                        request_timeout=180,
                    )
                    repair_data = self._extract_json(repair_response.text)
                    repair_raw = self._extract_script_unit_items(repair_data)
                    repair_units = self._normalize_text_units(repair_raw)
                    if repair_units:
                        repair_coverage = self._script_source_coverage(repair_units, source_focus)
                        repair_oos = self._detect_out_of_scope_phrases(repair_units, context_blob)
                        repair_style = self._detect_ai_transition_templates(repair_units) + self._detect_ai_cliche_phrases(repair_units)
                        if not self._can_accept_repair(coverage, repair_coverage, source_repair_required, repair_oos, repair_style):
                            pass
                        else:
                            text_units = repair_units
                            raw_units = repair_raw
                            coverage = repair_coverage
                            out_of_scope_terms = repair_oos
                            style_violations = repair_style
                            source_repair_required = self._needs_source_repair(source_focus, repair_coverage)
                            text_repaired = True
                except Exception:
                    pass

            if not text_units:
                return None

            script_units = self._merge_enrichment(text_units, raw_units)

            guardrail_mode = "enforce" if needs_repair else "pass"
            return SkillResult(
                skill=self.name,
                version=self.version,
                output={
                    "script_units": script_units,
                    "decision_meta": {
                        "provider": provider,
                        "model": model,
                        "text_stage_model": model,
                        "enrichment_stage_model": model,
                        "decision_mode": "llm_rewrite",
                        "generation_mode": "combined",
                        "text_stage_llm_used": True,
                        "text_stage_mode": "combined_prompt",
                        "text_stage_repair_applied": text_repaired,
                        "enrichment_stage_llm_used": True,
                        "enrichment_stage_fallback_used": False,
                        "enrichment_stage_error": None,
                        "source_anchor": source_focus,
                        "source_coverage": coverage,
                        "source_repair_required": source_repair_required,
                        "out_of_scope_terms": out_of_scope_terms,
                        "repair_applied": text_repaired,
                        "style_violations": style_violations,
                        "guardrail_mode": guardrail_mode,
                    },
                },
                meta={
                    "status": "ready",
                    "message": "LLM combined single-call script units generated.",
                    "provider": provider,
                    "model": model,
                    "decision_mode": "llm_rewrite",
                    "generation_mode": "combined",
                    "source_anchor": source_focus,
                    "source_coverage": coverage,
                    "source_repair_required": source_repair_required,
                    "out_of_scope_terms": out_of_scope_terms,
                    "repair_applied": text_repaired,
                    "style_violations": style_violations,
                    "guardrail_mode": guardrail_mode,
                },
            )
        except Exception:
            return None

    def run(self, payload: Dict[str, Any]) -> SkillResult:
        outline = payload.get("outline") or {}
        route = payload.get("route") or {}
        audio_items = payload.get("audio") or payload.get("audio_items") or []
        selected_segments = payload.get("selected_segments") or []
        source_post = payload.get("source_post") or {}

        outline_items = self._normalize_outline(outline)
        audio_snippets = self._normalize_audio(audio_items)
        segment_items = self._normalize_selected_segments(selected_segments)
        source_post_info = self._normalize_source_post(source_post)
        source_focus = self._extract_source_focus(source_post_info)
        context_blob = self._build_context_blob(source_post_info, outline_items, audio_snippets, segment_items)

        if not outline_items and not audio_snippets and not source_post_info.get("title") and not source_post_info.get("body"):
            return SkillResult(
                skill=self.name,
                version=self.version,
                output={"script_units": []},
                meta={
                    "status": "failed",
                    "message": "No usable outline/audio facts for script rewriting.",
                    "decision_mode": "llm_failed",
                },
            )

        provider = _get_script_provider()
        text_model = get_text_stage_model()
        enrich_model = get_enrich_stage_model()
        client = create_llm_client(provider=provider)

        # ── 优先：合并单次调用 ──────────────────────────────────
        combined_result = self._run_combined(
            client=client,
            model=text_model,
            provider=provider,
            source_post_info=source_post_info,
            source_focus=source_focus,
            outline_items=outline_items,
            audio_snippets=audio_snippets,
            segment_items=segment_items,
            route=route,
            outline=outline,
            context_blob=context_blob,
        )
        if combined_result is not None:
            return combined_result

        # ── Fallback：旧两阶段模式 ────────────────────────────
        text_prompt = self.REWRITE_TEXT_PROMPT.format(
            content_type=str(route.get("content_type") or "fast_news"),
            duration_target=str(route.get("duration_target") or outline.get("target_duration_sec") or 45),
            outline_json=json.dumps(outline_items, ensure_ascii=False, indent=2),
            audio_json=json.dumps(audio_snippets, ensure_ascii=False, indent=2),
            segments_json=json.dumps(segment_items, ensure_ascii=False, indent=2),
            source_post_json=json.dumps(source_post_info, ensure_ascii=False, indent=2),
            source_focus_json=json.dumps(source_focus, ensure_ascii=False, indent=2),
        )

        try:
            text_stage_mode = "full_prompt"
            try:
                response = generate_content(
                    client,
                    model=text_model,
                    contents=text_prompt,
                    response_mime_type="application/json",
                    retries=2,
                    request_timeout=180,
                )
                data = self._extract_json(response.text)
                text_units = self._normalize_text_units(self._extract_script_unit_items(data))
                if not text_units:
                    raise ValueError("full_prompt 未返回有效 text script_units")
            except Exception as full_exc:
                compact_prompt = self._build_compact_text_prompt(
                    source_post_info=source_post_info,
                    outline_items=outline_items,
                    audio_snippets=audio_snippets,
                    segment_items=segment_items,
                    route=route,
                    outline=outline,
                )
                response = generate_content(
                    client,
                    model=text_model,
                    contents=compact_prompt,
                    response_mime_type="application/json",
                    retries=1,
                    request_timeout=120,
                )
                data = self._extract_json(response.text)
                text_units = self._normalize_text_units(self._extract_script_unit_items(data))
                if not text_units:
                    raise ValueError(f"compact_prompt 未返回有效 text script_units; full_error={full_exc}")
                text_stage_mode = "compact_retry"

            coverage = self._script_source_coverage(text_units, source_focus)
            out_of_scope_terms = self._detect_out_of_scope_phrases(text_units, context_blob)
            style_violations = self._detect_ai_transition_templates(text_units) + self._detect_ai_cliche_phrases(text_units)
            source_repair_required = self._needs_source_repair(source_focus, coverage)
            text_repaired = False
            if not text_units:
                raise ValueError("LLM 未返回有效 script_units")

            needs_repair = source_repair_required or bool(out_of_scope_terms) or bool(style_violations)
            if needs_repair:
                repair_prompt = self._build_repair_prompt(
                    base_prompt=text_prompt,
                    source_focus=source_focus,
                    coverage=coverage,
                    current_units=text_units,
                    out_of_scope_terms=out_of_scope_terms or None,
                    style_violations=style_violations or None,
                )
                try:
                    repair_response = generate_content(
                        client,
                        model=text_model,
                        contents=repair_prompt,
                        response_mime_type="application/json",
                        retries=1,
                        request_timeout=180,
                    )
                    repair_data = self._extract_json(repair_response.text)
                    repair_units = self._normalize_text_units(self._extract_script_unit_items(repair_data))
                    if repair_units:
                        repair_coverage = self._script_source_coverage(repair_units, source_focus)
                        repair_oos = self._detect_out_of_scope_phrases(repair_units, context_blob)
                        repair_style = self._detect_ai_transition_templates(repair_units) + self._detect_ai_cliche_phrases(repair_units)
                        if self._can_accept_repair(coverage, repair_coverage, source_repair_required, repair_oos, repair_style):
                            text_units = repair_units
                            coverage = repair_coverage
                            out_of_scope_terms = repair_oos
                            style_violations = repair_style
                            source_repair_required = self._needs_source_repair(source_focus, repair_coverage)
                            text_repaired = True
                except Exception:
                    pass

            enrich_prompt = self.ENRICH_PROMPT.format(
                outline_json=json.dumps(outline_items, ensure_ascii=False, indent=2),
                audio_json=json.dumps(audio_snippets, ensure_ascii=False, indent=2),
                segments_json=json.dumps(segment_items, ensure_ascii=False, indent=2),
                source_post_json=json.dumps(source_post_info, ensure_ascii=False, indent=2),
                script_units_json=json.dumps(
                    [{"unit_id": idx, "role": item.get("role"), "text": item.get("text")} for idx, item in enumerate(text_units, start=1)],
                    ensure_ascii=False,
                    indent=2,
                ),
            )
            stage2_llm_used = False
            stage2_fallback_used = False
            stage2_error = None
            try:
                enrich_response = generate_content(
                    client,
                    model=enrich_model,
                    contents=enrich_prompt,
                    response_mime_type="application/json",
                    retries=2,
                    request_timeout=150,
                )
                enrich_data = self._extract_json(enrich_response.text)
                enrich_units = self._extract_script_unit_items(enrich_data)
                if not enrich_units:
                    raise ValueError("enrichment 阶段未返回有效 script_units")
                script_units = self._merge_enrichment(text_units, enrich_units)
                stage2_llm_used = True
            except Exception as enrich_exc:
                script_units = self._merge_enrichment(text_units, [])
                stage2_fallback_used = True
                stage2_error = str(enrich_exc)

            guardrail_mode = "enforce" if needs_repair else "pass"
            return SkillResult(
                skill=self.name,
                version=self.version,
                output={
                    "script_units": script_units,
                    "decision_meta": {
                        "provider": provider,
                        "model": text_model,
                        "text_stage_model": text_model,
                        "enrichment_stage_model": enrich_model,
                        "decision_mode": "llm_rewrite",
                        "generation_mode": "two_stage_fallback",
                        "text_stage_llm_used": True,
                        "text_stage_mode": text_stage_mode,
                        "text_stage_repair_applied": text_repaired,
                        "enrichment_stage_llm_used": stage2_llm_used,
                        "enrichment_stage_fallback_used": stage2_fallback_used,
                        "enrichment_stage_error": stage2_error,
                        "source_anchor": source_focus,
                        "source_coverage": coverage,
                        "source_repair_required": source_repair_required,
                        "out_of_scope_terms": out_of_scope_terms,
                        "repair_applied": text_repaired,
                        "style_violations": style_violations,
                        "guardrail_mode": guardrail_mode,
                    },
                },
                meta={
                    "status": "ready",
                    "message": "LLM rewritten script units generated (two-stage fallback).",
                    "provider": provider,
                    "model": text_model,
                    "text_stage_model": text_model,
                    "enrichment_stage_model": enrich_model,
                    "decision_mode": "llm_rewrite",
                    "generation_mode": "two_stage_fallback",
                    "source_anchor": source_focus,
                    "source_coverage": coverage,
                    "source_repair_required": source_repair_required,
                    "out_of_scope_terms": out_of_scope_terms,
                    "repair_applied": text_repaired,
                    "style_violations": style_violations,
                    "guardrail_mode": guardrail_mode,
                    "text_stage_llm_used": True,
                    "text_stage_mode": text_stage_mode,
                    "enrichment_stage_llm_used": stage2_llm_used,
                    "enrichment_stage_fallback_used": stage2_fallback_used,
                    "enrichment_stage_error": stage2_error,
                },
            )
        except Exception as exc:
            return SkillResult(
                skill=self.name,
                version=self.version,
                output={"script_units": []},
                meta={
                    "status": "failed",
                    "message": f"Script rewriting failed: {exc}",
                    "provider": provider,
                    "model": text_model,
                    "text_stage_model": text_model,
                    "enrichment_stage_model": enrich_model,
                    "decision_mode": "llm_failed",
                    "source_anchor": source_focus,
                },
            )
