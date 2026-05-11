import argparse
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from llm_client import create_llm_client, generate_content, get_text_llm_provider
from pipeline.skills.prompt_skill_loader import load_prompt_text

load_project_env(__file__)

DEFAULT_QWEN_MODEL = "qwen3.5-flash"
DEFAULT_TRANSLATE_REQUEST_TIMEOUT_SECONDS = 45
DEFAULT_TRANSLATE_CONCURRENCY = 3
DEFAULT_TRANSLATE_BATCH_SIZE = 1

def get_text_model(provider=None):
    """获取文本生成模型"""
    provider = provider or get_text_llm_provider()
    override = (
        os.getenv("XAI_TOP10_TRANSLATE_MODEL")
        or os.getenv("QWEN_TRANSLATE_MODEL")
    )
    if override:
        return override
    if provider == "deepseek":
        return os.getenv("DEEPSEEK_TEXT_MODEL", "deepseek-v4-pro")
    if provider == "qwen":
        return DEFAULT_QWEN_MODEL
    return os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

TRANSLATE_MODEL = get_text_model()
TRANSLATE_SUMMARY_PROMPT = load_prompt_text("translate_result_summaries_skill.md")


def get_env_int(name: str, default: int) -> int:
    raw = str(os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default

def extract_json(text: str):
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Model response does not contain a JSON array.")
    return json.loads(cleaned[start:end + 1])


def translate_batch(client, entries):
    prompt = TRANSLATE_SUMMARY_PROMPT.format(
        entries_json=json.dumps(entries, ensure_ascii=False, indent=2)
    )
    response = generate_content(
        client,
        model=TRANSLATE_MODEL,
        contents=prompt,
        response_mime_type="application/json",
        request_timeout=get_env_int(
            "XAI_TOP10_TRANSLATE_REQUEST_TIMEOUT_SECONDS",
            DEFAULT_TRANSLATE_REQUEST_TIMEOUT_SECONDS,
        ),
        provider=get_text_llm_provider(),
    )
    return extract_json(response.text)


def collect_translations(rows):
    translations = {}
    for row in rows:
        rank = row.get("rank")
        text = str(row.get("author_summary_zh") or "").strip()
        if rank is not None and text:
            translations[int(rank)] = text
    return translations


def translate_batch_with_fallback(client, batch):
    try:
        return collect_translations(translate_batch(client, batch))
    except Exception as exc:
        print(
            f"translate batch failed; retrying individually: {exc}",
            file=sys.stderr,
            flush=True,
        )

    if len(batch) == 1:
        return {}

    translations = {}
    for entry in batch:
        try:
            translations.update(collect_translations(translate_batch(client, [entry])))
        except Exception as exc:
            print(
                f"translate item rank={entry.get('rank')} failed: {exc}",
                file=sys.stderr,
                flush=True,
            )
    return translations


def translate_entries(client, entries, batch_size=None, max_workers=None):
    resolved_batch_size = max(1, int(batch_size or DEFAULT_TRANSLATE_BATCH_SIZE))
    resolved_workers = max(
        1,
        int(max_workers or get_env_int("XAI_TOP10_TRANSLATE_CONCURRENCY", DEFAULT_TRANSLATE_CONCURRENCY)),
    )
    batches = [
        entries[start:start + resolved_batch_size]
        for start in range(0, len(entries), resolved_batch_size)
    ]
    translations = {}
    if not batches:
        return translations

    with ThreadPoolExecutor(max_workers=min(resolved_workers, len(batches))) as executor:
        future_map = {
            executor.submit(translate_batch_with_fallback, client, batch): batch
            for batch in batches
        }
        for future in as_completed(future_map):
            try:
                translations.update(future.result())
            except Exception as exc:
                batch = future_map[future]
                ranks = [entry.get("rank") for entry in batch]
                print(
                    f"translate worker failed for ranks={ranks}: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
    return translations


def needs_translation(item):
    source_text = item.get("author_summary") or item.get("summary") or ""
    translated_text = item.get("author_summary_zh") or ""
    return bool(source_text and (not translated_text or translated_text == source_text))


def build_pending_entries(items):
    return [
        {
            "rank": item.get("rank"),
            "author_summary": item.get("author_summary") or item.get("summary") or "",
        }
        for item in items
        if needs_translation(item)
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--result", required=True, help="xai top10 result.json path")
    args = parser.parse_args()

    with open(args.result, "r", encoding="utf-8") as f:
        payload = json.load(f)

    items = payload.get("items") or []
    pending = build_pending_entries(items)

    if not pending:
        print("no-op")
        return

    provider = get_text_llm_provider()
    client = create_llm_client(provider=provider)

    translations = translate_entries(client, pending)

    changed = 0
    for item in items:
        rank = item.get("rank")
        if rank in translations:
            item["author_summary_zh"] = translations[rank]
            changed += 1

    with open(args.result, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"translated {changed} items")
    if changed < len(pending):
        raise RuntimeError(f"translated {changed}/{len(pending)} items")


if __name__ == "__main__":
    main()
