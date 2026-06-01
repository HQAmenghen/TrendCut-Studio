import hashlib
import json
import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
for candidate in (PROJECT_ROOT, PYTHON_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from pipeline.material_state import (  # noqa: E402
    compute_narration_signature,
    compute_script_signature,
    get_narration_text,
    normalize_source_post,
)


class MaterialStateTest(unittest.TestCase):
    def test_compute_script_signature_uses_stable_subset(self):
        script_units = [
            {"id": "s1", "role": "hook", "text": "第一句", "ignored": "x"},
            {"id": "s2", "role": "body", "text": "第二句"},
        ]
        expected_payload = [
            {"id": "s1", "role": "hook", "text": "第一句"},
            {"id": "s2", "role": "body", "text": "第二句"},
        ]
        expected_raw = json.dumps(expected_payload, ensure_ascii=False, sort_keys=True)

        self.assertEqual(
            compute_script_signature(script_units),
            hashlib.sha1(expected_raw.encode("utf-8")).hexdigest(),
        )

    def test_narration_text_prefers_script_units_then_narration_payload(self):
        self.assertEqual(
            get_narration_text([{"text": "第一句"}, {"text": "第二句"}], {"full_text": "fallback"}),
            "第一句\n第二句",
        )
        self.assertEqual(get_narration_text([], {"full_text": "fallback"}), "fallback")
        self.assertEqual(compute_narration_signature([], {"full_text": "fallback"}), hashlib.sha1("fallback".encode("utf-8")).hexdigest())

    def test_normalize_source_post_accepts_nested_source_meta(self):
        payload = {
            "title": "金融分区素材",
            "body": "市场资金流变化。",
            "sourceAuthor": "market-watch",
            "sourcePostId": "post-1",
            "postUrl": "https://x.com/post/1",
            "materialUrl": "https://cdn.example.com/news.mp4",
            "source_meta": {
                "source_partition_id": "finance",
                "source_partition_label": "金融",
                "source_rank": "2",
            },
        }

        self.assertEqual(normalize_source_post(payload), {
            "title": "金融分区素材",
            "body": "市场资金流变化。",
            "author": "market-watch",
            "postId": "post-1",
            "postUrl": "https://x.com/post/1",
            "materialUrl": "https://cdn.example.com/news.mp4",
            "sourcePartitionId": "finance",
            "sourcePartitionLabel": "金融",
            "sourceRank": 2,
            "sourceMeta": {
                "sourcePartitionId": "finance",
                "sourcePartitionLabel": "金融",
                "sourceRank": 2,
            },
        })


if __name__ == "__main__":
    unittest.main()
