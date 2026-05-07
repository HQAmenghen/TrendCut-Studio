import json
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
for candidate in (PROJECT_ROOT, PYTHON_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from xai import translate_result_summaries as translator  # noqa: E402


class FakeResponse:
    def __init__(self, payload):
        self.text = payload


class TranslateResultSummariesTest(unittest.TestCase):
    def test_qwen_translation_uses_qwen35_flash_default_model(self):
        with patch.dict(
            "os.environ",
            {
                "LLM_PROVIDER": "qwen",
                "QWEN_TEXT_MODEL": "qwen3.5-plus",
                "XAI_TOP10_TRANSLATE_MODEL": "",
                "QWEN_TRANSLATE_MODEL": "",
            },
            clear=False,
        ):
            self.assertEqual(translator.get_text_model(), "qwen3.5-flash")

    def test_translate_entries_runs_three_batches_concurrently(self):
        entries = [
            {"rank": idx, "author_summary": f"summary {idx}"}
            for idx in range(1, 7)
        ]
        active = 0
        max_active = 0
        lock = threading.Lock()

        def fake_translate_batch(_client, batch):
            nonlocal active, max_active
            with lock:
                active += 1
                max_active = max(max_active, active)
            time.sleep(0.05)
            with lock:
                active -= 1
            return [
                {
                    "rank": batch[0]["rank"],
                    "author_summary_zh": f"中文 {batch[0]['rank']}",
                }
            ]

        with patch.object(translator, "translate_batch", side_effect=fake_translate_batch):
            translations = translator.translate_entries(
                object(),
                entries,
                batch_size=1,
                max_workers=3,
            )

        self.assertEqual(max_active, 3)
        self.assertEqual(len(translations), 6)

    def test_build_pending_entries_treats_source_text_fallback_as_untranslated(self):
        items = [
            {
                "rank": 1,
                "author_summary": "@A - Bitcoin rallies",
                "author_summary_zh": "@A - Bitcoin rallies",
            },
            {
                "rank": 2,
                "author_summary": "@B - Ethereum yields",
                "author_summary_zh": "@B - 以太坊收益",
            },
        ]

        pending = translator.build_pending_entries(items)

        self.assertEqual(
            pending,
            [{"rank": 1, "author_summary": "@A - Bitcoin rallies"}],
        )

    def test_falls_back_to_single_item_translation_when_batch_json_is_invalid(self):
        entries = [
            {"rank": 1, "author_summary": "@A - Bitcoin rallies"},
            {"rank": 2, "author_summary": "@B - Ethereum yields"},
        ]

        with patch.object(
            translator,
            "generate_content",
            side_effect=[
                FakeResponse('[{"rank": 1, "author_summary_zh": "坏 JSON"} {"rank": 2}]'),
                FakeResponse(json.dumps([{"rank": 1, "author_summary_zh": "@A - 比特币上涨"}], ensure_ascii=False)),
                FakeResponse(json.dumps([{"rank": 2, "author_summary_zh": "@B - 以太坊收益"}], ensure_ascii=False)),
            ],
        ):
            translations = translator.translate_entries(object(), entries, batch_size=2)

        self.assertEqual(
            translations,
            {
                1: "@A - 比特币上涨",
                2: "@B - 以太坊收益",
            },
        )


if __name__ == "__main__":
    unittest.main()
