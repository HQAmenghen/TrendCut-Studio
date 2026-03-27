import argparse
import io
import json
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_env import load_project_env
from gemini_client import create_gemini_client, generate_content

load_project_env(__file__)

DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"
GEMINI_MODEL = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)

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
    prompt = f"""
你是一个财经/热点短视频编辑助手。请把下面每条英文摘要翻译成自然、简洁、适合中文中台列表展示的中文。

要求：
1. 保留原意，不夸张，不补充未提到的信息。
2. 保留账号名、股票代码、专有名词和数字信息。
3. 输出必须是 JSON 数组。
4. 每一项必须包含字段：
   - rank
   - author_summary_zh

输入数据：
{json.dumps(entries, ensure_ascii=False, indent=2)}
"""
    response = generate_content(
        client,
        model=GEMINI_MODEL,
        contents=prompt,
    )
    return extract_json(response.text)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--result", required=True, help="xai top10 result.json path")
    args = parser.parse_args()

    with open(args.result, "r", encoding="utf-8") as f:
        payload = json.load(f)

    items = payload.get("items") or []
    pending = [
        {
            "rank": item.get("rank"),
            "author_summary": item.get("author_summary") or item.get("summary") or ""
        }
        for item in items
        if (item.get("author_summary") or item.get("summary")) and not item.get("author_summary_zh")
    ]

    if not pending:
        print("no-op")
        return

    client = create_gemini_client()

    translations = {}
    batch_size = 8
    for start in range(0, len(pending), batch_size):
        batch = pending[start:start + batch_size]
        result = translate_batch(client, batch)
        for row in result:
            rank = row.get("rank")
            text = str(row.get("author_summary_zh") or "").strip()
            if rank is not None and text:
                translations[int(rank)] = text

    changed = 0
    for item in items:
        rank = item.get("rank")
        if rank in translations:
            item["author_summary_zh"] = translations[rank]
            changed += 1

    with open(args.result, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"translated {changed} items")


if __name__ == "__main__":
    main()
