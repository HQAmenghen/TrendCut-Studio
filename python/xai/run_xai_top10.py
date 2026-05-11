import argparse
import json
import os
import re
import sys
import time
import traceback
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from script_protocol import emit_error, emit_result, emit_stage

import httpx
import requests
from openai import (
    APIConnectionError,
    APIError,
    InternalServerError,
    OpenAI,
    PermissionDeniedError,
)
from requests_oauthlib import OAuth1

load_project_env(__file__)


def get_env_int(name: str, default: int, minimum: int = 1, maximum: int = 32) -> int:
    raw = os.getenv(name)
    if raw is None or not str(raw).strip():
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


DEFAULT_ACCOUNTS = [
    "BitcoinMagazine",
    "AltcoinDaily",
    "TrendingBitcoin",
    "Vivek4real_",
    "BinanceUS",
    "ABTC",
    "coinspace_",
    "WatcherGuru",
    "CoinDesk",
    "BitcoinNews21M",
    "DocumentingBTC",
    "BitcoinArchive",
    "cz_binance",
    "TomLeeTracker",
    "BMNRBullz",
    "web3bannie",
    "fiatarchive",
    "SimplyBitcoin",
    "WOLF_Bitcoin_",
    "KevinWSHPod",
    "elonmusk",
]

MODEL = os.getenv("XAI_MODEL", "grok-4-0709")
BEIJING_TZ = timezone(timedelta(hours=8))
MAX_CANDIDATES_PER_ACCOUNT = 5
ENRICH_LIMIT = 10
CANDIDATE_WORKERS = get_env_int("XAI_TOP10_CANDIDATE_WORKERS", 4)
ENRICH_WORKERS = get_env_int("XAI_TOP10_ENRICH_WORKERS", 2)
FOLLOWER_WORKERS = get_env_int("XAI_TOP10_FOLLOWER_WORKERS", 4)
MIN_VALID_FOLLOWERS = 100
MAX_VALID_FOLLOWERS = 1_000_000_000
MIN_REQUIRED_VIEWS = 15_000
MAX_VIDEO_DURATION_SEC = 600

BASE_DIR = Path(__file__).resolve().parent
PARTIAL_PATH = BASE_DIR / "result.partial.json"
CACHE_PATH = BASE_DIR / "xai_top10_cache.json"
RESULT_PATH = BASE_DIR / "result.json"
FOLLOWER_MIRROR_TIMEOUT = 35
X_API_BASE = "https://api.x.com/2"
MIN_PREFERRED_VIDEO_HEIGHT = 720
RUN_LOG_PATH = BASE_DIR / "run_log.txt"
RUN_ERROR_PATH = BASE_DIR / "run_error.log"
X_SEARCH_COST_PER_1000 = 5.0
ACCOUNTS_CONFIG_PATH = BASE_DIR / "xai_accounts.json"
DEFAULT_PARTITION_ID = "crypto"
DEFAULT_PARTITION_META = {
    "crypto": {"label": "加密", "description": "Crypto / Web3 热点账号池"},
    "finance": {"label": "金融", "description": "宏观、市场和金融账号池"},
    "tech": {"label": "科技", "description": "科技产品和创业账号池"},
    "ai": {"label": "AI", "description": "AI 模型、应用和研究账号池"},
}
CURRENT_PARTITION = {
    "id": DEFAULT_PARTITION_ID,
    "label": DEFAULT_PARTITION_META[DEFAULT_PARTITION_ID]["label"],
    "description": DEFAULT_PARTITION_META[DEFAULT_PARTITION_ID]["description"],
}
XAI_INPUT_COST_PER_1M = float(os.getenv("XAI_INPUT_COST_PER_1M", "3.0"))
XAI_CACHED_INPUT_COST_PER_1M = float(os.getenv("XAI_CACHED_INPUT_COST_PER_1M", "0.75"))
XAI_OUTPUT_COST_PER_1M = float(os.getenv("XAI_OUTPUT_COST_PER_1M", "15.0"))
XAI_REASONING_COST_PER_1M = float(os.getenv("XAI_REASONING_COST_PER_1M", str(XAI_OUTPUT_COST_PER_1M)))
USAGE_LOCK = Lock()
USAGE_TOTALS = {
    "requests": 0,
    "input_tokens": 0,
    "cached_input_tokens": 0,
    "output_tokens": 0,
    "reasoning_tokens": 0,
}


def usage_value(obj, *path) -> int:
    current = obj
    for key in path:
        if current is None:
            return 0
        if isinstance(current, dict):
            current = current.get(key)
        else:
            current = getattr(current, key, None)
    return safe_number(current) or 0


def reset_usage_totals() -> None:
    with USAGE_LOCK:
        for key in USAGE_TOTALS:
            USAGE_TOTALS[key] = 0


def record_usage(response) -> None:
    usage = getattr(response, "usage", None)
    if usage is None:
        return

    input_tokens = usage_value(usage, "input_tokens")
    cached_input_tokens = (
        usage_value(usage, "input_tokens_details", "cached_tokens")
        or usage_value(usage, "input_tokens_details", "cached_input_tokens")
        or usage_value(usage, "cached_input_tokens")
    )
    output_tokens = usage_value(usage, "output_tokens")
    reasoning_tokens = (
        usage_value(usage, "output_tokens_details", "reasoning_tokens")
        or usage_value(usage, "reasoning_tokens")
    )

    with USAGE_LOCK:
        USAGE_TOTALS["requests"] += 1
        USAGE_TOTALS["input_tokens"] += input_tokens
        USAGE_TOTALS["cached_input_tokens"] += cached_input_tokens
        USAGE_TOTALS["output_tokens"] += output_tokens
        USAGE_TOTALS["reasoning_tokens"] += reasoning_tokens


def clean_secret(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip().strip("\"'“”‘’")
    return cleaned or None


def normalize_partition_id(value: str | None, fallback: str = DEFAULT_PARTITION_ID) -> str:
    raw = str(value or "").strip().lower()
    normalized = re.sub(r"[^a-z0-9_-]+", "-", raw).strip("-")[:40]
    return normalized or fallback


def sanitize_account_list(values) -> list[str]:
    accounts: list[str] = []
    seen: set[str] = set()
    if not isinstance(values, list):
        return accounts
    for account in values:
        normalized = str(account).strip().lstrip("@")
        if not normalized or normalized in seen:
            continue
        accounts.append(normalized)
        seen.add(normalized)
    return accounts


def merge_account_lists(*groups: list[str]) -> list[str]:
    accounts: list[str] = []
    seen: set[str] = set()
    for group in groups:
        for account in group:
            normalized = str(account).strip().lstrip("@")
            if not normalized or normalized in seen:
                continue
            accounts.append(normalized)
            seen.add(normalized)
    return accounts


def load_accounts(partition_id: str = DEFAULT_PARTITION_ID) -> tuple[list[str], dict]:
    selected_id = normalize_partition_id(partition_id)
    default_meta = DEFAULT_PARTITION_META.get(selected_id, {})
    selected_meta = {
        "id": selected_id,
        "label": default_meta.get("label") or selected_id,
        "description": default_meta.get("description") or "",
    }
    try:
        if not ACCOUNTS_CONFIG_PATH.exists():
            accounts = list(DEFAULT_ACCOUNTS) if selected_id == DEFAULT_PARTITION_ID else []
            return accounts, selected_meta
        payload = json.loads(ACCOUNTS_CONFIG_PATH.read_text(encoding="utf-8"))

        partitions = payload.get("partitions")
        if isinstance(partitions, list):
            selected_partition = None
            for partition in partitions:
                if not isinstance(partition, dict):
                    continue
                candidate_id = normalize_partition_id(partition.get("id") or partition.get("key") or partition.get("label"))
                if candidate_id == selected_id:
                    selected_partition = partition
                    break

            if selected_partition is None:
                selected_partition = next((item for item in partitions if isinstance(item, dict)), {})
                selected_id = normalize_partition_id(selected_partition.get("id") if isinstance(selected_partition, dict) else None)

            if isinstance(selected_partition, dict):
                default_meta = DEFAULT_PARTITION_META.get(selected_id, {})
                selected_meta = {
                    "id": selected_id,
                    "label": str(selected_partition.get("label") or selected_partition.get("name") or default_meta.get("label") or selected_id).strip(),
                    "description": str(selected_partition.get("description") or default_meta.get("description") or "").strip(),
                }
                configured_accounts = sanitize_account_list(selected_partition.get("accounts"))
                accounts = configured_accounts
                if selected_id == DEFAULT_PARTITION_ID:
                    accounts = merge_account_lists(list(DEFAULT_ACCOUNTS), configured_accounts)
                return accounts, selected_meta

        configured_accounts = sanitize_account_list(payload.get("accounts"))
        accounts = configured_accounts
        if selected_id == DEFAULT_PARTITION_ID:
            accounts = merge_account_lists(list(DEFAULT_ACCOUNTS), configured_accounts)
        return accounts, selected_meta
    except (json.JSONDecodeError, OSError, TypeError, AttributeError):
        pass
    accounts = list(DEFAULT_ACCOUNTS) if selected_id == DEFAULT_PARTITION_ID else []
    return accounts, selected_meta


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run xAI Top10 discovery for a configured account partition.")
    parser.add_argument("--partition-id", default=DEFAULT_PARTITION_ID)
    parser.add_argument("--result", default=str(RESULT_PATH))
    parser.add_argument("--partial", default=str(PARTIAL_PATH))
    parser.add_argument("--log", default=str(RUN_LOG_PATH))
    parser.add_argument("--error-log", default=str(RUN_ERROR_PATH))
    return parser.parse_args(argv)


def configure_run_paths(args: argparse.Namespace) -> None:
    global RESULT_PATH, PARTIAL_PATH, RUN_LOG_PATH, RUN_ERROR_PATH
    RESULT_PATH = Path(args.result)
    PARTIAL_PATH = Path(args.partial)
    RUN_LOG_PATH = Path(args.log)
    RUN_ERROR_PATH = Path(args.error_log)
    for target in [RESULT_PATH, PARTIAL_PATH, RUN_LOG_PATH, RUN_ERROR_PATH]:
        target.parent.mkdir(parents=True, exist_ok=True)


def build_client() -> OpenAI:
    api_key = clean_secret(os.getenv("XAI_API_KEY"))
    if not api_key:
        raise RuntimeError(
            "Missing XAI_API_KEY. In PowerShell run: $env:XAI_API_KEY='your_key_here'"
        )
    if not api_key.isascii():
        raise RuntimeError(
            "XAI_API_KEY contains non-ASCII characters. Re-set it with plain ASCII text only."
        )

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

    return OpenAI(
        api_key=api_key,
        base_url="https://api.x.ai/v1",
        http_client=http_client,
    )


def log(message: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {message}"
    print(line, file=sys.stderr, flush=True)
    with RUN_LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def log_error(message: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] ERROR: {message}"
    print(line, file=sys.stderr, flush=True)
    with RUN_ERROR_PATH.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def load_cache() -> dict:
    if not CACHE_PATH.exists():
        return {"followers": {}, "candidates": {}, "posts": {}}
    try:
        cache = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        followers = cache.get("followers", {})
        for account, value in list(followers.items()):
            if not isinstance(value, dict):
                followers[account] = {
                    "value": value,
                    "source": "历史缓存",
                }
        cache["followers"] = followers
        return cache
    except (json.JSONDecodeError, OSError):
        return {"followers": {}, "candidates": {}, "posts": {}}


def save_cache(cache: dict) -> None:
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def write_partial(stage: str, done: int, total: int, collected: int) -> None:
    PARTIAL_PATH.write_text(
        json.dumps(
            {
                "stage": stage,
                "done": done,
                "total": total,
                "collected_items": collected,
                "partition": CURRENT_PARTITION,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def call_json(prompt: str, timeout: int) -> dict:
    client = build_client()
    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        try:
            response = client.responses.create(
                model=MODEL,
                input=prompt,
                tools=[{"type": "x_search"}],
                tool_choice="required",
                timeout=timeout,
            )
            record_usage(response)
            text = (response.output_text or "").strip()
            if not text:
                raise RuntimeError("No text returned from xAI response.")
            return json.loads(text)
        except PermissionDeniedError as exc:
            detail = getattr(exc, "body", None) or str(exc)
            raise RuntimeError(f"Permission denied from xAI API: {detail}") from exc
        except InternalServerError as exc:
            detail = getattr(exc, "body", None) or str(exc)
            if attempt == max_attempts:
                raise RuntimeError(
                    f"xAI server remained unavailable after {max_attempts} attempts: {detail}"
                ) from exc
            log(f"xAI returned 500, retrying ({attempt}/{max_attempts})...")
            time.sleep(5 * attempt)
        except APIConnectionError as exc:
            detail = getattr(exc, "body", None) or str(exc)
            if attempt == max_attempts:
                raise RuntimeError(
                    f"xAI connection failed after {max_attempts} attempts: {detail}"
                ) from exc
            log(f"Connection error, retrying ({attempt}/{max_attempts})...")
            time.sleep(4 * attempt)
        except APIError as exc:
            detail = getattr(exc, "body", None) or str(exc)
            raise RuntimeError(f"xAI API request failed: {detail}") from exc
        except json.JSONDecodeError as exc:
            raise RuntimeError("xAI did not return valid JSON.") from exc

    raise RuntimeError("Unexpected empty retry loop.")


def candidate_prompt(account: str, since_iso: str, until_iso: str) -> str:
    return f"""
You are a crypto video selection assistant.

Core objective:
- We are not looking for generic engagement bait.
- We want videos with true remake potential for short-form replication.
- Absolute views matter most. Only keep videos that are already getting clearly high playback volume.

Rules:
1. You must actually use the X search tool.
2. Do not hallucinate. Every field must come from this tool call.
3. Search posts from @{account} within the last 24 hours.
4. Keep only posts that clearly contain video media.
5. Only keep videos with views >= {MIN_REQUIRED_VIEWS}. If the views cannot be verified as at least {MIN_REQUIRED_VIEWS}, exclude the post.
6. Prefer posts with higher absolute views, even before engagement-based tie-breaks.
7. Return at most {MAX_CANDIDATES_PER_ACCOUNT} candidate posts.
8. If nothing matches, return an empty items array.
9. Output valid JSON only.

Time range:
- since: {since_iso}
- until: {until_iso}

Output:
{{
  "account": "{account}",
  "items": [
    {{
      "post_id": "1234567890123456789",
      "post_url": "https://x.com/{account}/status/1234567890123456789",
      "published_at": "YYYY-MM-DD HH:MM",
      "published_at_iso": "ISO8601",
      "summary": "short viral summary"
    }}
  ]
}}
"""


def enrich_prompt(account: str, post_url: str, post_id: str | int | None) -> str:
    post_ref = post_url if post_url else f"https://x.com/{account}/status/{post_id}"
    return f"""
You are a crypto video selection assistant.

Core objective:
- We only want videos with strong remake potential.
- Absolute views are the primary signal.
- Any post below {MIN_REQUIRED_VIEWS} views must be treated as ineligible.

Rules:
1. You must actually use the X search tool.
2. Do not hallucinate. Every field must come from this tool call.
3. Query only this post: {post_ref}
4. Return real values. If a field cannot be found, return null.
5. For this task, prefer thread-level post fetch behavior over generic keyword search. If the system supports an internal capability equivalent to thread fetch for a specific post URL or post ID, use that capability first.
6. You must inspect the complete media payload for this exact post and collect all visible video variants before selecting video_url.
7. Return all visible mp4 variants in a field named video_variants. Each variant must include url, width, and height when available.
8. video_url must be a real mp4 direct link. If multiple qualities exist, prefer the best mp4 at 720p or above. If there is no 720p version, return the best available mp4.
9. Do not return followers in this response.
10. Return the real views count for this exact post whenever available.
11. If views are below {MIN_REQUIRED_VIEWS}, still return the true views value so the caller can discard it.
12. Output valid JSON only.

Output:
{{
  "post_id": "{post_id or ''}",
  "post_url": "{post_url}",
  "published_at": "YYYY-MM-DD HH:MM",
  "published_at_iso": "ISO8601",
  "summary": "short viral summary",
  "views": 0,
  "likes": 0,
  "reposts": 0,
  "replies": 0,
  "video_url": "https://video.twimg.com/...mp4",
  "video_variants": [
    {{
      "url": "https://video.twimg.com/...mp4",
      "width": 1280,
      "height": 720
    }}
  ]
}}
"""


def follower_prompt(account: str) -> str:
    return f"""
You are a crypto video selection assistant.

Rules:
1. You must actually use the X search tool.
2. Do not hallucinate. Every field must come from this tool call.
3. Query only the real followers count for @{account}.
4. If it cannot be found, return null.
5. Output valid JSON only.

Output:
{{
  "account": "{account}",
  "followers": 0
}}
"""


def safe_number(value) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def parse_human_count(text: str | None) -> int | None:
    if not text:
        return None
    cleaned = text.strip().upper().replace(",", "")
    multiplier = 1
    if cleaned.endswith("K"):
        multiplier = 1_000
        cleaned = cleaned[:-1]
    elif cleaned.endswith("M"):
        multiplier = 1_000_000
        cleaned = cleaned[:-1]
    elif cleaned.endswith("B"):
        multiplier = 1_000_000_000
        cleaned = cleaned[:-1]
    try:
        return int(float(cleaned) * multiplier)
    except ValueError:
        return None


def normalize_followers(value) -> int | None:
    if isinstance(value, dict):
        value = value.get("value")
    followers = safe_number(value)
    if followers is None:
        return None
    if followers <= MIN_VALID_FOLLOWERS or followers > MAX_VALID_FOLLOWERS:
        return None
    return followers


def get_follower_source(cache: dict, account: str) -> str | None:
    raw = cache.get("followers", {}).get(account)
    if isinstance(raw, dict):
        return raw.get("source")
    if raw is not None:
        return "历史缓存"
    return None


def build_http_client() -> httpx.Client:
    env_proxy = (
        os.getenv("XAI_PROXY")
        or os.getenv("HTTPS_PROXY")
        or os.getenv("https_proxy")
        or os.getenv("HTTP_PROXY")
        or os.getenv("http_proxy")
    )
    detected = urllib.request.getproxies()
    proxy = env_proxy or detected.get("https") or detected.get("http")
    kwargs = {
        "timeout": FOLLOWER_MIRROR_TIMEOUT,
        "follow_redirects": True,
        "headers": {"User-Agent": "Mozilla/5.0"},
        "trust_env": False,
        "http2": False,
    }
    if proxy:
        kwargs["proxy"] = proxy
    return httpx.Client(**kwargs)


def build_requests_kwargs(timeout: int | None = None) -> dict:
    env_proxy = (
        os.getenv("XAI_PROXY")
        or os.getenv("HTTPS_PROXY")
        or os.getenv("https_proxy")
        or os.getenv("HTTP_PROXY")
        or os.getenv("http_proxy")
    )
    detected = urllib.request.getproxies()
    proxy = env_proxy or detected.get("https") or detected.get("http")
    kwargs = {
        "timeout": timeout or FOLLOWER_MIRROR_TIMEOUT,
        "headers": {"User-Agent": "Mozilla/5.0"},
    }
    if proxy:
        kwargs["proxies"] = {"http": proxy, "https": proxy}
    return kwargs


def build_x_oauth1() -> OAuth1 | None:
    consumer_key = clean_secret(os.getenv("X_CONSUMER_KEY"))
    consumer_secret = clean_secret(os.getenv("X_CONSUMER_SECRET"))
    access_token = clean_secret(os.getenv("X_ACCESS_TOKEN"))
    access_token_secret = clean_secret(os.getenv("X_ACCESS_TOKEN_SECRET"))
    values = [consumer_key, consumer_secret, access_token, access_token_secret]
    if not all(values):
        return None
    if not all(value.isascii() for value in values):
        return None
    return OAuth1(
        consumer_key,
        client_secret=consumer_secret,
        resource_owner_key=access_token,
        resource_owner_secret=access_token_secret,
        signature_type="auth_header",
    )


def fetch_followers_from_x_api(account: str) -> int | None:
    bearer = clean_secret(os.getenv("X_BEARER_TOKEN"))
    if not bearer:
        return None
    if not bearer.isascii():
        return None
    url = f"{X_API_BASE}/users/by/username/{account}"
    params = {"user.fields": "public_metrics"}
    headers = {
        "Authorization": f"Bearer {bearer}",
        "User-Agent": "Mozilla/5.0",
    }
    try:
        with build_http_client() as client:
            response = client.get(url, params=params, headers=headers)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, json.JSONDecodeError):
        return None

    followers = (
        payload.get("data", {})
        .get("public_metrics", {})
        .get("followers_count")
    )
    return normalize_followers(followers)


def fetch_video_variants_from_x_api(post_id: str | None) -> list[dict]:
    if not post_id:
        return []
    params = {
        "expansions": "attachments.media_keys",
        "tweet.fields": "attachments",
        "media.fields": "variants,height,width,type,url,preview_image_url,duration_ms,media_key",
    }
    request_kwargs = build_requests_kwargs(timeout=FOLLOWER_MIRROR_TIMEOUT)

    oauth = build_x_oauth1()
    tweet_payload = None
    if oauth is not None:
        try:
            response = requests.get(
                f"{X_API_BASE}/tweets/{post_id}",
                params=params,
                auth=oauth,
                **request_kwargs,
            )
            if response.status_code == 200:
                tweet_payload = response.json()
            else:
                log_error(f"Video tweet lookup via OAuth1 failed for {post_id}: HTTP {response.status_code}")
        except (requests.RequestException, json.JSONDecodeError):
            log_error(f"Video tweet lookup via OAuth1 exception for {post_id}")

    if tweet_payload is None:
        bearer = clean_secret(os.getenv("X_BEARER_TOKEN"))
        if not bearer or not bearer.isascii():
            return []
        headers = {
            "Authorization": f"Bearer {bearer}",
            "User-Agent": "Mozilla/5.0",
        }
        try:
            with build_http_client() as client:
                tweet_response = client.get(
                    f"{X_API_BASE}/tweets/{post_id}",
                    params=params,
                    headers=headers,
                )
                if tweet_response.status_code != 200:
                    log_error(f"Video tweet lookup failed for {post_id}: HTTP {tweet_response.status_code}")
                    return []
                tweet_payload = tweet_response.json()
        except (httpx.HTTPError, json.JSONDecodeError):
            log_error(f"Video tweet lookup exception for {post_id}")
            return []

    variants = []
    media_items = (tweet_payload.get("includes", {}) or {}).get("media", []) or []
    if not media_items:
        media_keys = (
            tweet_payload.get("data", {})
            .get("attachments", {})
            .get("media_keys", [])
        )
        if not media_keys:
            log(f"Video tweet lookup returned no media_keys/includes.media for {post_id}.")
        else:
            log(f"Video tweet lookup returned media_keys but no includes.media for {post_id}.")
        return []

    for media_item in media_items:
        if media_item.get("type") not in {"video", "animated_gif"}:
            log(
                f"Video tweet lookup non-video include for {post_id}: {media_item.get('type')}"
            )
            continue
        width = media_item.get("width")
        height = media_item.get("height")
        duration_ms = media_item.get("duration_ms")
        for variant in media_item.get("variants", []) or []:
            url = variant.get("url")
            content_type = variant.get("content_type")
            if not url or content_type != "video/mp4":
                continue
            vw, vh = parse_video_resolution(url)
            variants.append(
                {
                    "url": url,
                    "bit_rate": variant.get("bit_rate"),
                    "width": vw or width,
                    "height": vh or height,
                    "duration_ms": duration_ms,
                }
            )

    if not variants:
        log(f"Video tweet lookup returned 0 mp4 variants for {post_id}.")
    return variants


def extract_video_urls_from_text(text: str) -> list[str]:
    if not text:
        return []
    normalized = (
        text.replace("\\/", "/")
        .replace("\\u0026", "&")
        .replace("&amp;", "&")
    )
    patterns = [
        r"https://video\.twimg\.com/[^\s\"'<>]+?\.mp4(?:\?[^\s\"'<>]+)?",
        r"https://video\.twimg\.com/[^\s\"'<>]+?\.m3u8(?:\?[^\s\"'<>]+)?",
    ]
    found = []
    for pattern in patterns:
        found.extend(re.findall(pattern, normalized, flags=re.I))
    deduped = []
    seen = set()
    for url in found:
        cleaned = url.strip(" ,);]>")
        if cleaned not in seen:
            seen.add(cleaned)
            deduped.append(cleaned)
    return deduped


def fetch_video_variants_from_post_page(post_url: str | None) -> list[dict]:
    if not post_url:
        return []
    candidate_urls = [
        f"https://r.jina.ai/http://{post_url.removeprefix('https://')}",
        post_url,
    ]
    collected = []
    seen = set()
    try:
        with build_http_client() as client:
            for url in candidate_urls:
                try:
                    response = client.get(url)
                    response.raise_for_status()
                    for media_url in extract_video_urls_from_text(response.text):
                        if media_url in seen:
                            continue
                        seen.add(media_url)
                        width, height = parse_video_resolution(media_url)
                        collected.append(
                            {
                                "url": media_url,
                                "bit_rate": None,
                                "width": width,
                                "height": height,
                            }
                        )
                except httpx.HTTPError:
                    log(f"Video page fallback failed for {post_url} via {url}.")
    except httpx.HTTPError:
        return []

    mp4_only = [item for item in collected if ".mp4" in (item.get("url") or "").lower()]
    if mp4_only:
        log(f"Video page fallback found {len(mp4_only)} mp4 candidates for {post_url}.")
    return mp4_only


def fetch_followers_from_profile_page(account: str) -> int | None:
    url = f"https://r.jina.ai/http://x.com/{account}"
    patterns = [
        r"\[([0-9.,]+\s*[KMB]?)\s+Followers\]",
        r"([0-9.,]+\s*[KMB]?)\s+Followers",
        r"\[([0-9.,]+\s*[KMB]?)\s+Verified Followers\]",
    ]
    try:
        with build_http_client() as client:
            text = client.get(url).text
    except httpx.HTTPError:
        return None

    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return normalize_followers(parse_human_count(match.group(1)))
    return None


def format_views(views: int | None) -> str | None:
    if views is None:
        return None
    if views >= 1_000_000:
        return f"{views / 1_000_000:.1f}M"
    if views >= 1_000:
        return f"{views / 1_000:.0f}K" if views >= 10_000 else f"{views / 1_000:.1f}K"
    return str(views)


def format_ratio(value: float | None) -> str | None:
    if value is None:
        return None
    if value >= 1:
        return f"{value:.2f}x"
    return f"{value * 100:.2f}%"


def parse_iso_to_bj(iso_text: str | None) -> tuple[str | None, str | None]:
    if not iso_text:
        return None, None
    try:
        normalized = iso_text.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        bj_dt = dt.astimezone(BEIJING_TZ)
        return bj_dt.strftime("%Y-%m-%d %H:%M"), bj_dt.isoformat()
    except ValueError:
        return None, None


def normalize_candidate(account: str, item: dict) -> dict | None:
    post_url = item.get("post_url")
    post_id = item.get("post_id")
    if not post_url and not post_id:
        return None
    published_at, published_iso = parse_iso_to_bj(item.get("published_at_iso"))
    if not published_at:
        published_at = item.get("published_at")
    return {
        "author": account,
        "post_id": str(post_id) if post_id is not None else None,
        "post_url": post_url,
        "published_at": published_at,
        "published_at_iso": published_iso or item.get("published_at_iso"),
        "summary": item.get("summary"),
    }


def candidate_sort_key(item: dict) -> tuple:
    summary = item.get("summary") or ""
    info_bonus = 1 if "http" not in summary.lower() else 0
    return (
        1 if item.get("published_at_iso") else 0,
        item.get("published_at_iso") or "",
        info_bonus,
        len(summary),
    )


def score_video_url(video_url: str | None) -> tuple:
    if not video_url:
        return (0, 0)
    match = re.search(r"/vid/[^/]+/(\d+)x(\d+)/", video_url)
    if not match:
        return (1, 0)
    width = int(match.group(1))
    height = int(match.group(2))
    preferred = 1 if height >= MIN_PREFERRED_VIDEO_HEIGHT or width >= 1280 else 0
    return (2 + preferred, width * height)


def choose_better_video(current: str | None, candidate: str | None) -> str | None:
    if current is None:
        return candidate
    if candidate is None:
        return current
    return candidate if score_video_url(candidate) > score_video_url(current) else current


def choose_preferred_variant(variants: list[dict]) -> dict | None:
    if not variants:
        return None
    eligible = [
        variant
        for variant in variants
        if (variant.get("height") or 0) >= MIN_PREFERRED_VIDEO_HEIGHT
        or (variant.get("width") or 0) >= 1280
    ]
    pool = eligible if eligible else variants
    return max(
        pool,
        key=lambda item: (
            1 if (item.get("height") or 0) >= MIN_PREFERRED_VIDEO_HEIGHT else 0,
            item.get("bit_rate") or 0,
            (item.get("width") or 0) * (item.get("height") or 0),
        ),
    )


def parse_video_resolution(video_url: str | None) -> tuple[int | None, int | None]:
    if not video_url:
        return None, None
    match = re.search(r"/vid/[^/]+/(\d+)x(\d+)/", video_url)
    if not match:
        return None, None
    return int(match.group(1)), int(match.group(2))


def compute_metrics(item: dict) -> None:
    views = safe_number(item.get("views"))
    likes = safe_number(item.get("likes")) or 0
    reposts = safe_number(item.get("reposts")) or 0
    replies = safe_number(item.get("replies")) or 0
    followers = normalize_followers(item.get("followers"))

    item["views"] = views
    item["likes"] = likes
    item["reposts"] = reposts
    item["replies"] = replies
    item["followers"] = followers
    item["views_display"] = format_views(views)

    if views and views > 0:
        engagement_rate = (likes + reposts + replies) / views
        item["engagement_rate"] = round(engagement_rate, 4)
    else:
        item["engagement_rate"] = 0.0

    if views and followers:
        ratio = round(views / followers, 4)
    else:
        ratio = None
    item["over_follower_ratio"] = ratio
    item["ratio_display"] = format_ratio(ratio)

    video_width, video_height = parse_video_resolution(item.get("video_url"))
    item["video_width"] = video_width
    item["video_height"] = video_height
    item["video_resolution"] = (
        f"{video_width}x{video_height}" if video_width and video_height else None
    )
    item["video_meets_720p"] = bool(video_height and video_height >= MIN_PREFERRED_VIDEO_HEIGHT)
    item["video_variant_count"] = len(item.get("video_variants") or [])

    baseline_views = safe_number(item.get("account_avg_views"))
    if views and baseline_views and baseline_views > 0:
        baseline_ratio = round(views / baseline_views, 2)
    else:
        baseline_ratio = None
    item["breakout_ratio"] = baseline_ratio
    item["breakout_display"] = f"{baseline_ratio:.2f}x" if baseline_ratio is not None else None

    summary = (item.get("summary") or "").lower()
    viral_bonus = 0
    viral_terms = [
        "break",
        "bull",
        "pump",
        "launch",
        "war",
        "tariff",
        "etf",
        "moon",
        "bitcoin",
        "ethereum",
        "crypto",
        "trump",
        "sec",
    ]
    if any(term in summary for term in viral_terms):
        viral_bonus += 8

    ratio_part = min(ratio or 0, 20) * 1.2 if (ratio or 0) >= 1 else 0
    baseline_part = min((baseline_ratio or 0), 5) * 4
    engage_part = min(item["engagement_rate"] * 1400, 45)
    views_part = min((views or 0) / 10000, 25)

    recency_part = 0
    iso_text = item.get("published_at_iso")
    if iso_text:
        try:
            dt = datetime.fromisoformat(iso_text.replace("Z", "+00:00"))
            age_hours = max(0, (datetime.now(BEIJING_TZ) - dt.astimezone(BEIJING_TZ)).total_seconds() / 3600)
            recency_part = max(0, 12 - age_hours * 0.4)
        except ValueError:
            recency_part = 0

    item["hot_score"] = min(
        100,
        round(ratio_part + baseline_part + engage_part + views_part + recency_part + viral_bonus),
    )


def final_sort_key(item: dict) -> tuple:
    ratio = item.get("over_follower_ratio")
    baseline_ratio = item.get("breakout_ratio") or 0
    strong_ratio = 1 if ratio is not None and ratio >= 1.0 else 0
    if strong_ratio:
        return (
            2,
            item.get("hot_score") or 0,
            ratio or 0,
            baseline_ratio,
            item.get("engagement_rate") or 0,
            item.get("views") or 0,
            item.get("published_at_iso") or "",
        )
    return (
        1,
        item.get("hot_score") or 0,
        baseline_ratio,
        item.get("engagement_rate") or 0,
        item.get("views") or 0,
        item.get("published_at_iso") or "",
        ratio or -1,
    )


def scan_account(account: str, since_iso: str, until_iso: str, cache: dict) -> list[dict]:
    window_key = f"{account}|{since_iso}|{until_iso}"
    cached = cache["candidates"].get(window_key)
    if cached is not None:
        return cached

    result = call_json(candidate_prompt(account, since_iso, until_iso), timeout=60)
    items = []
    for raw_item in result.get("items", []):
        normalized = normalize_candidate(account, raw_item)
        if normalized:
            items.append(normalized)
    cache["candidates"][window_key] = items
    save_cache(cache)
    return items


def fetch_followers(account: str, cache: dict) -> int | None:
    x_api_followers = fetch_followers_from_x_api(account)
    if x_api_followers is not None:
        cache["followers"][account] = {
            "value": x_api_followers,
            "source": "官方接口",
        }
        save_cache(cache)
        return x_api_followers

    page_followers = fetch_followers_from_profile_page(account)
    if page_followers is not None:
        cache["followers"][account] = {
            "value": page_followers,
            "source": "主页提取",
        }
        save_cache(cache)
        return page_followers

    result = call_json(follower_prompt(account), timeout=35)
    followers = normalize_followers(result.get("followers"))
    if followers is not None:
        cache["followers"][account] = {
            "value": followers,
            "source": "X搜索",
        }
        save_cache(cache)
        return followers

    cached = normalize_followers(cache["followers"].get(account))
    if cached is not None:
        return cached
    return None


def enrich_post(item: dict, cache: dict) -> dict:
    post_key = item.get("post_url") or item.get("post_id")
    cached_post = cache["posts"].get(post_key) if post_key else None
    if cached_post is not None:
        merged = dict(item)
        merged.update(cached_post)
        merged["video_url"] = choose_better_video(merged.get("video_url"), cached_post.get("video_url"))
        cached_variants = cached_post.get("video_variants") or []
        if cached_variants:
            merged["video_variants"] = cached_variants
            return merged

    result = call_json(
        enrich_prompt(item["author"], item.get("post_url"), item.get("post_id")),
        timeout=55,
    )
    merged = dict(item)
    merged.update(result)

    bj_published_at, bj_published_iso = parse_iso_to_bj(merged.get("published_at_iso"))
    if bj_published_at:
        merged["published_at"] = bj_published_at
    if bj_published_iso:
        merged["published_at_iso"] = bj_published_iso

    xai_variants = result.get("video_variants") or []
    normalized_xai_variants = []
    for variant in xai_variants:
        if not isinstance(variant, dict):
            continue
        url = variant.get("url")
        if not url:
            continue
        width = safe_number(variant.get("width"))
        height = safe_number(variant.get("height"))
        if not (width and height):
            width, height = parse_video_resolution(url)
        normalized_xai_variants.append(
            {
                "url": url,
                "bit_rate": safe_number(variant.get("bit_rate")),
                "width": width,
                "height": height,
            }
        )

    video_variants = list(normalized_xai_variants)
    video_variants.extend(
        fetch_video_variants_from_x_api(str(merged.get("post_id") or item.get("post_id") or ""))
    )
    if not video_variants:
        video_variants = fetch_video_variants_from_post_page(merged.get("post_url") or item.get("post_url"))
    preferred_variant = choose_preferred_variant(video_variants)
    if preferred_variant:
        merged["video_url"] = preferred_variant.get("url") or merged.get("video_url")
        merged["video_variants"] = video_variants
        duration_ms = preferred_variant.get("duration_ms")
        if duration_ms is None:
            for v in video_variants:
                if v.get("duration_ms"):
                    duration_ms = v["duration_ms"]
                    break
        merged["video_duration_ms"] = safe_number(duration_ms)
    else:
        merged["video_variants"] = []

    if post_key:
        cache["posts"][post_key] = {
            "post_id": merged.get("post_id"),
            "post_url": merged.get("post_url"),
            "published_at": merged.get("published_at"),
            "published_at_iso": merged.get("published_at_iso"),
            "summary": merged.get("summary"),
            "views": merged.get("views"),
            "likes": merged.get("likes"),
            "reposts": merged.get("reposts"),
            "replies": merged.get("replies"),
            "video_url": merged.get("video_url"),
            "video_variants": merged.get("video_variants"),
        }
        save_cache(cache)
    return merged


def compute_account_baselines(candidates: list[dict], cache: dict) -> dict:
    baselines = {}
    posts_cache = cache.get("posts", {})
    for account in {item["author"] for item in candidates if item.get("author")}:
        views_pool = []
        for post in posts_cache.values():
            if not isinstance(post, dict):
                continue
            post_url = post.get("post_url", "")
            if f"/{account}/status/" not in post_url:
                continue
            views = safe_number(post.get("views"))
            if views and views > 0:
                views_pool.append(views)
        if views_pool:
            baselines[account] = round(sum(views_pool) / len(views_pool))
    return baselines


def fill_missing_baselines(items: list[dict], baseline_map: dict) -> dict:
    enriched_map = dict(baseline_map)
    grouped = {}
    for item in items:
        account = item.get("author")
        views = safe_number(item.get("views"))
        if not account or not views or views <= 0:
            continue
        grouped.setdefault(account, []).append(views)

    for account, values in grouped.items():
        if account not in enriched_map and values:
            enriched_map[account] = round(sum(values) / len(values))
    return enriched_map


def build_cost_estimate(total_accounts: int, total_enrich: int, total_followers: int, total_ranked: int) -> dict:
    xai_calls = total_accounts + total_enrich + total_followers
    xai_tool_cost = round((xai_calls / 1000) * X_SEARCH_COST_PER_1000, 4)
    x_api_calls = total_followers + total_ranked
    with USAGE_LOCK:
        requests_count = USAGE_TOTALS["requests"]
        input_tokens = USAGE_TOTALS["input_tokens"]
        cached_input_tokens = USAGE_TOTALS["cached_input_tokens"]
        output_tokens = USAGE_TOTALS["output_tokens"]
        reasoning_tokens = USAGE_TOTALS["reasoning_tokens"]

    non_cached_input_tokens = max(0, input_tokens - cached_input_tokens)
    input_cost = (non_cached_input_tokens / 1_000_000) * XAI_INPUT_COST_PER_1M
    cached_input_cost = (cached_input_tokens / 1_000_000) * XAI_CACHED_INPUT_COST_PER_1M
    output_cost = (output_tokens / 1_000_000) * XAI_OUTPUT_COST_PER_1M
    reasoning_cost = (reasoning_tokens / 1_000_000) * XAI_REASONING_COST_PER_1M
    xai_token_cost = round(input_cost + cached_input_cost + output_cost + reasoning_cost, 6)
    estimated_total_cost = round(xai_tool_cost + xai_token_cost, 6)

    return {
        "xai_requests_observed": requests_count,
        "xai_request_count": xai_calls,
        "xai_input_tokens": input_tokens,
        "xai_cached_input_tokens": cached_input_tokens,
        "xai_output_tokens": output_tokens,
        "xai_reasoning_tokens": reasoning_tokens,
        "xai_token_cost_usd": xai_token_cost,
        "xai_x_search_tool_usd": xai_tool_cost,
        "estimated_total_cost_usd": estimated_total_cost,
        "xapi_request_count_est": x_api_calls,
        "notes": "xAI tool fee and observed token fee estimated; X API endpoint charges not included",
    }


def main() -> int:
    global CURRENT_PARTITION
    args = parse_args()
    configure_run_paths(args)
    RUN_LOG_PATH.write_text("", encoding="utf-8")
    RUN_ERROR_PATH.write_text("", encoding="utf-8")
    PARTIAL_PATH.write_text("", encoding="utf-8")
    log("Run started.")
    accounts, partition = load_accounts(args.partition_id)
    CURRENT_PARTITION = partition
    if not accounts:
        raise RuntimeError(f"Partition {partition.get('label') or partition.get('id')} has no accounts configured.")
    emit_stage("bootstrap", f"正在启动 {partition.get('label')} Top10 榜单任务")
    reset_usage_totals()

    try:
        build_client()
    except RuntimeError as exc:
        log_error(str(exc))
        return 1

    cache = load_cache()
    detected = urllib.request.getproxies()
    proxy = (
        os.getenv("XAI_PROXY")
        or os.getenv("HTTPS_PROXY")
        or os.getenv("https_proxy")
        or os.getenv("HTTP_PROXY")
        or os.getenv("http_proxy")
        or detected.get("https")
        or detected.get("http")
    )
    if proxy:
        log(f"Using proxy for xAI requests: {proxy}")
    else:
        log("No proxy detected, using direct connection.")

    now_bj = datetime.now(BEIJING_TZ).replace(second=0, microsecond=0)
    since_bj = now_bj - timedelta(hours=24)
    since_iso = since_bj.isoformat()
    until_iso = now_bj.isoformat()

    candidates = []
    completed = 0
    total_accounts = len(accounts)
    log(f"Starting candidate scan for {total_accounts} accounts in partition {partition.get('id')} with concurrency {CANDIDATE_WORKERS}.")
    emit_stage("candidate_scan", f"开始扫描「{partition.get('label')}」{total_accounts} 个账号的候选视频")

    with ThreadPoolExecutor(max_workers=CANDIDATE_WORKERS) as executor:
        future_map = {
            executor.submit(scan_account, account, since_iso, until_iso, cache): account
            for account in accounts
        }
        for future in as_completed(future_map):
            account = future_map[future]
            completed += 1
            log(f"Candidate scan {completed}/{total_accounts}: @{account}")
            try:
                candidates.extend(future.result())
            except Exception as exc:
                log_error(f"Candidate scan failed for @{account}: {exc}")
                log_error(traceback.format_exc())
            write_partial("candidate_scan", completed, total_accounts, len(candidates))

    deduped_candidates = {}
    for item in candidates:
        key = item.get("post_url") or item.get("post_id")
        if not key:
            continue
        current = deduped_candidates.get(key)
        if current is None or candidate_sort_key(item) > candidate_sort_key(current):
            deduped_candidates[key] = item

    ranked_candidates = sorted(
        deduped_candidates.values(),
        key=candidate_sort_key,
        reverse=True,
    )[:ENRICH_LIMIT]
    log(f"Candidate scan complete. {len(candidates)} raw candidates, {len(ranked_candidates)} selected for enrich.")

    enriched = []
    completed = 0
    total_enrich = len(ranked_candidates)
    log(f"Starting enrich stage for {total_enrich} posts with concurrency {ENRICH_WORKERS}.")
    emit_stage("enrich", f"开始补全 {total_enrich} 条候选视频")

    with ThreadPoolExecutor(max_workers=ENRICH_WORKERS) as executor:
        future_map = {
            executor.submit(enrich_post, item, cache): item
            for item in ranked_candidates
        }
        for future in as_completed(future_map):
            item = future_map[future]
            completed += 1
            log(f"Enrich {completed}/{total_enrich}: {item.get('post_url')}")
            try:
                enriched.append(future.result())
            except Exception as exc:
                log_error(f"Enrich failed for {item.get('post_url')}: {exc}")
                log_error(traceback.format_exc())
            write_partial("enrich", completed, total_enrich, len(enriched))

    authors_needed = sorted({item["author"] for item in enriched if item.get("author")})
    completed = 0
    log(f"Starting followers stage for {len(authors_needed)} accounts with concurrency {FOLLOWER_WORKERS}.")
    emit_stage("followers", f"开始补全 {len(authors_needed)} 个作者的粉丝信息")
    with ThreadPoolExecutor(max_workers=FOLLOWER_WORKERS) as executor:
        future_map = {
            executor.submit(fetch_followers, account, cache): account for account in authors_needed
        }
        for future in as_completed(future_map):
            account = future_map[future]
            completed += 1
            log(f"Followers {completed}/{len(authors_needed)}: @{account}")
            try:
                followers = future.result()
            except Exception as exc:
                log_error(f"Follower fetch failed for @{account}: {exc}")
                log_error(traceback.format_exc())
            write_partial("followers", completed, len(authors_needed), len(enriched))
    save_cache(cache)

    baseline_map = compute_account_baselines(ranked_candidates, cache)
    baseline_map = fill_missing_baselines(enriched, baseline_map)

    eligible_items = []
    for item in enriched:
        item["followers"] = normalize_followers(cache["followers"].get(item["author"]))
        item["followers_source"] = get_follower_source(cache, item["author"])
        item["account_avg_views"] = baseline_map.get(item["author"])
        compute_metrics(item)
        if (item.get("views") or 0) < MIN_REQUIRED_VIEWS:
            continue
        video_duration_ms = safe_number(item.get("video_duration_ms"))
        if video_duration_ms and video_duration_ms > MAX_VIDEO_DURATION_SEC * 1000:
            log(f"跳过视频时长超限: {item.get('post_url')} ({video_duration_ms / 1000:.0f}s > {MAX_VIDEO_DURATION_SEC}s)")
            continue
        eligible_items.append(item)

    ranked = sorted(eligible_items, key=final_sort_key, reverse=True)[:10]

    output_items = []
    for idx, item in enumerate(ranked, start=1):
        output_items.append(
            {
                "rank": idx,
                "author": item.get("author"),
                "author_summary": (
                    f"@{item.get('author')} - {item.get('summary')}"
                    if item.get("author") and item.get("summary")
                    else None
                ),
                "followers": item.get("followers"),
                "followers_source": item.get("followers_source"),
                "post_id": item.get("post_id"),
                "published_at": item.get("published_at"),
                "published_at_iso": item.get("published_at_iso"),
                "views": item.get("views"),
                "views_display": item.get("views_display"),
                "likes": item.get("likes"),
                "reposts": item.get("reposts"),
                "replies": item.get("replies"),
                "engagement_rate": item.get("engagement_rate"),
                "over_follower_ratio": item.get("over_follower_ratio"),
                "ratio_display": item.get("ratio_display"),
                "account_avg_views": item.get("account_avg_views"),
                "breakout_ratio": item.get("breakout_ratio"),
                "breakout_display": item.get("breakout_display"),
                "hot_score": item.get("hot_score"),
                "post_url": item.get("post_url"),
                "video_url": item.get("video_url"),
                "video_resolution": item.get("video_resolution"),
                "video_meets_720p": item.get("video_meets_720p"),
                "video_variant_count": item.get("video_variant_count"),
                "source_partition_id": partition.get("id"),
                "source_partition_label": partition.get("label"),
            }
        )

    output = {
        "title": f"{partition.get('label')}过去24小时Top10视频（仅保留播放量>={MIN_REQUIRED_VIEWS}，按复刻爆款潜力排序）",
        "partition": partition,
        "time_range": {
            "since": since_iso,
            "until": until_iso,
            "timezone": "Asia/Shanghai",
            "window_hours": 24,
        },
        "cost_estimate": build_cost_estimate(total_accounts, total_enrich, len(authors_needed), len(ranked)),
        "accounts_scanned": accounts,
        "items": output_items,
        "total_items": len(output_items),
    }

    RESULT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"Run finished. Saved result to {RESULT_PATH}.")
    emit_result(
        "xAI Top10 榜单生成完成",
        result_json=str(RESULT_PATH),
        total_items=len(output_items),
        estimated_total_cost_usd=output["cost_estimate"].get("estimated_total_cost_usd"),
    )
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        emit_error(
            "XAI_RUN_FAILED",
            "xAI Top10 榜单执行失败",
            stage="xai",
            details=str(exc),
            hint="请检查 xAI Key、X API 凭证、网络代理和外部接口限流情况",
        )
        raise
