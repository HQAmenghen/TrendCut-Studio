"""Freshness checks for time-sensitive narration scripts."""

from __future__ import annotations

import json
import os
import re
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

try:
    import httpx
    from openai import OpenAI
except Exception:  # pragma: no cover - import availability is environment-specific
    httpx = None
    OpenAI = None


BEIJING_TZ = timezone(timedelta(hours=8))
DEFAULT_FRESH_MODEL = "grok-4-0709"
MAX_QUERY_CHARS = 220
MAX_CONTEXT_CHARS = 2400

FRESHNESS_KEYWORDS = [
    "今天", "昨日", "昨天", "刚刚", "最新", "最近", "开年", "本周", "本月", "今年", "明年",
    "总统", "特朗普", "拜登", "trump", "biden", "president",
    "比特币", "bitcoin", "btc", "加密", "crypto", "美元", "dollar", "美联储", "fed",
    "监管", "政策", "etf", "价格", "市场", "股市", "避险",
]


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return default
    return str(raw).strip().lower() not in {"0", "false", "no", "off"}


def _clean_secret(value: Any) -> str:
    return str(value or "").strip().strip('"').strip("'")


def _pick_text(*values: Any) -> str:
    parts = []
    for value in values:
        text = re.sub(r"\s+", " ", str(value or "")).strip()
        if text:
            parts.append(text)
    return " ".join(parts).strip()


def _extract_json(text: str) -> Dict[str, Any]:
    raw = str(text or "").strip()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        pass
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL | re.IGNORECASE)
    if fenced:
        return json.loads(fenced.group(1))
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        return json.loads(match.group(0))
    return {}


def _truncate(text: str, limit: int) -> str:
    value = str(text or "").strip()
    return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


def current_beijing_datetime() -> datetime:
    return datetime.now(BEIJING_TZ)


def is_time_sensitive_source(source_post: Dict[str, Any]) -> bool:
    text = _pick_text(
        source_post.get("title"),
        source_post.get("body"),
        source_post.get("sourcePartitionId"),
        source_post.get("sourcePartitionLabel"),
    )
    if not text:
        return False
    normalized = text.lower()
    return any(keyword.lower() in normalized for keyword in FRESHNESS_KEYWORDS)


def build_freshness_query(source_post: Dict[str, Any]) -> str:
    title = str(source_post.get("title") or "").strip()
    body = str(source_post.get("body") or "").strip()
    text = _pick_text(title, body)
    text = re.sub(r"https?://\S+", "", text).strip()
    return _truncate(text, MAX_QUERY_CHARS)


def _build_client() -> Any:
    api_key = _clean_secret(os.getenv("XAI_API_KEY"))
    if not api_key:
        raise RuntimeError("Missing XAI_API_KEY")
    if not api_key.isascii():
        raise RuntimeError("XAI_API_KEY contains non-ASCII characters")
    if OpenAI is None or httpx is None:
        raise RuntimeError("openai/httpx dependencies are unavailable")

    env_proxy = (
        os.getenv("XAI_PROXY")
        or os.getenv("HTTPS_PROXY")
        or os.getenv("https_proxy")
        or os.getenv("HTTP_PROXY")
        or os.getenv("http_proxy")
    )
    detected = urllib.request.getproxies()
    proxy = env_proxy or detected.get("https") or detected.get("http")
    if proxy:
        http_client = httpx.Client(proxy=proxy, trust_env=False, http2=False)
    else:
        http_client = httpx.Client(trust_env=False, http2=False)
    return OpenAI(api_key=api_key, base_url="https://api.x.ai/v1", http_client=http_client)


def _search_prompt(query: str, now: datetime) -> str:
    current_date = now.strftime("%Y-%m-%d")
    current_year = now.strftime("%Y")
    previous_year = str(int(current_year) - 1)
    return f"""
You are verifying facts for a Chinese short-video narration script.

You must use the X search tool. Do not rely on model memory.

Current date: {current_date} Asia/Shanghai.
Source topic/query:
{query}

Return valid JSON only:
{{
  "summary": "one Chinese paragraph with the newest verified context",
  "verified_facts": [
    {{
      "fact": "Chinese fact sentence",
      "published_at": "YYYY-MM-DD or null",
      "source": "source/account/publication",
      "url": "https://..."
    }}
  ],
  "date_guidance": "Chinese guidance for wording the current timing",
  "stale_phrases_to_avoid": ["avoid stale timing such as {previous_year}年开年 unless it is explicitly the historical subject"],
  "confidence": "high | medium | low"
}}

Rules:
1. Focus on current timing, speaker identity, direct quote context, and whether old-year wording would be misleading.
2. If sources conflict, say so in summary and keep confidence low.
3. Do not invent URLs or dates.
4. Keep verified_facts to at most 5 items.
"""


def _normalize_search_payload(payload: Dict[str, Any], now: datetime, query: str, model: str) -> Dict[str, Any]:
    facts = []
    for item in payload.get("verified_facts") or []:
        if not isinstance(item, dict):
            continue
        fact = str(item.get("fact") or "").strip()
        if not fact:
            continue
        facts.append({
            "fact": _truncate(fact, 240),
            "published_at": str(item.get("published_at") or "").strip() or None,
            "source": str(item.get("source") or "").strip(),
            "url": str(item.get("url") or "").strip(),
        })
        if len(facts) >= 5:
            break

    current_year = now.year
    stale_phrases = [
        str(item).strip()
        for item in (payload.get("stale_phrases_to_avoid") or [])
        if str(item).strip()
    ][:8]
    previous_year = str(current_year - 1)
    if previous_year not in " ".join(stale_phrases):
        stale_phrases.append(f"不要把当前事件写成{previous_year}年开年，除非输入材料明确在讲历史回顾。")

    return {
        "enabled": True,
        "required": True,
        "status": "ready" if facts or payload.get("summary") else "empty",
        "searched": True,
        "provider": "xai",
        "model": model,
        "checked_at": now.isoformat(),
        "current_date": now.strftime("%Y-%m-%d"),
        "current_year": current_year,
        "query": query,
        "summary": _truncate(str(payload.get("summary") or "").strip(), 600),
        "verified_facts": facts,
        "stale_or_unsafe_claims": stale_phrases,
        "date_guidance": _truncate(str(payload.get("date_guidance") or "").strip(), 360),
        "stale_phrases_to_avoid": stale_phrases,
        "source_notes": [
            _truncate(
                " | ".join(
                    part
                    for part in [
                        str(item.get("published_at") or "").strip(),
                        str(item.get("source") or "").strip(),
                        str(item.get("url") or "").strip(),
                    ]
                    if part
                ),
                240,
            )
            for item in facts
        ],
        "confidence": str(payload.get("confidence") or "low").strip() or "low",
        "error": "",
    }


def build_fresh_context(source_post: Dict[str, Any], *, now: datetime | None = None) -> Dict[str, Any]:
    now = now or current_beijing_datetime()
    current_year = now.year
    base = {
        "enabled": _env_bool("SCRIPT_FRESH_CONTEXT_ENABLED", True),
        "required": False,
        "status": "not_required",
        "searched": False,
        "provider": "xai",
        "model": os.getenv("SCRIPT_FRESH_CONTEXT_MODEL") or os.getenv("XAI_MODEL") or DEFAULT_FRESH_MODEL,
        "checked_at": now.isoformat(),
        "current_date": now.strftime("%Y-%m-%d"),
        "current_year": current_year,
        "query": "",
        "summary": "",
        "verified_facts": [],
        "stale_or_unsafe_claims": [
            f"不要把当前事件写成{current_year - 1}年开年，除非输入材料明确在讲历史回顾。"
        ],
        "date_guidance": f"当前日期是 {now.strftime('%Y-%m-%d')}，涉及新闻、市场和政策判断时必须使用当前年份 {current_year}。",
        "stale_phrases_to_avoid": [
            f"不要把当前事件写成{current_year - 1}年开年，除非输入材料明确在讲历史回顾。"
        ],
        "source_notes": [],
        "confidence": "low",
        "error": "",
    }
    if not base["enabled"]:
        return {**base, "status": "disabled"}
    if not is_time_sensitive_source(source_post):
        return base

    query = build_freshness_query(source_post)
    if not query:
        return base
    base.update({"required": True, "status": "pending", "query": query})

    if not _clean_secret(os.getenv("XAI_API_KEY")):
        return {**base, "status": "skipped_missing_key", "error": "Missing XAI_API_KEY"}

    model = str(base["model"])
    try:
        client = _build_client()
        try:
            response = client.responses.create(
                model=model,
                input=_search_prompt(query, now),
                tools=[{"type": "x_search"}],
                tool_choice="required",
                timeout=int(os.getenv("SCRIPT_FRESH_CONTEXT_TIMEOUT_SECONDS", "60")),
            )
        finally:
            close_method = getattr(client, "close", None)
            if callable(close_method):
                close_method()
        payload = _extract_json(getattr(response, "output_text", "") or "")
        if not payload:
            return {**base, "status": "invalid_response", "error": "xAI search returned non-JSON output"}
        return _normalize_search_payload(payload, now, query, model)
    except Exception as exc:
        return {**base, "status": "failed", "error": str(exc)[:500]}


def fresh_context_for_prompt(fresh_context: Dict[str, Any] | None) -> Dict[str, Any]:
    if not isinstance(fresh_context, dict):
        return {}
    allowed = {
        "status",
        "provider",
        "model",
        "checked_at",
        "current_date",
        "current_year",
        "query",
        "summary",
        "verified_facts",
        "date_guidance",
        "stale_phrases_to_avoid",
        "confidence",
        "error",
    }
    compact = {key: fresh_context.get(key) for key in allowed if key in fresh_context}
    raw = json.dumps(compact, ensure_ascii=False)
    if len(raw) > MAX_CONTEXT_CHARS:
        compact["summary"] = _truncate(str(compact.get("summary") or ""), 360)
        compact["verified_facts"] = list(compact.get("verified_facts") or [])[:3]
    return compact


def append_fresh_context_to_blob(context_blob: str, fresh_context: Dict[str, Any] | None) -> str:
    prompt_context = fresh_context_for_prompt(fresh_context)
    if not prompt_context:
        return context_blob
    return "\n".join([
        str(context_blob or ""),
        "fresh_context:",
        json.dumps(prompt_context, ensure_ascii=False, sort_keys=True),
    ]).strip()
