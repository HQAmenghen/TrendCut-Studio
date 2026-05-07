import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
for candidate in (PROJECT_ROOT, PYTHON_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from review import ai_video_review  # noqa: E402


class FakeResponse:
    def __init__(self, payload):
        self.text = payload


class AiVideoReviewTest(unittest.TestCase):
    def test_title_review_uses_qwen_text_model_when_primary_model_is_multimodal(self):
        calls = []

        def fake_generate_content(_client, *, model, contents, response_mime_type=None):
            calls.append(model)
            if model == "qwen3-vl-flash":
                raise RuntimeError("InvalidParameter: url error, please check url")
            return FakeResponse(json.dumps({
                "score": 76,
                "relevance": {"score": 78, "comment": "相关"},
                "appeal": {"score": 75, "comment": "有吸引力"},
                "keywords": {"score": 72, "comment": "关键词可用"},
                "readability": {"score": 80, "comment": "易读"},
                "suggestions": [],
                "alternative_titles": []
            }, ensure_ascii=False))

        with patch.object(ai_video_review, "get_llm_provider", return_value="qwen"), \
             patch.dict("os.environ", {"QWEN_TEXT_MODEL": "qwen-plus"}, clear=False), \
             patch.object(ai_video_review, "generate_content", side_effect=fake_generate_content):
            result = ai_video_review.analyze_title_appeal(
                "中本聪留给宇宙",
                "Michael Saylor says he will leave everything to civilization.",
                object(),
                "qwen3-vl-flash",
            )

        self.assertEqual(result["score"], 76)
        self.assertEqual(calls, ["qwen-plus"])


if __name__ == "__main__":
    unittest.main()
