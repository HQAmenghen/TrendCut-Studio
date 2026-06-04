import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
PIPELINE_ROOT = PYTHON_ROOT / "pipeline"
for candidate in (PROJECT_ROOT, PYTHON_ROOT, PIPELINE_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from pipeline import score_material_segments as scorer  # noqa: E402


class FakeResponse:
    def __init__(self, payload):
        self.text = payload


class ScoreMaterialSegmentsProviderTest(unittest.TestCase):
    def test_material_scoring_uses_qwen_model_even_when_global_provider_is_vertex(self):
        with patch.dict(os.environ, {
            "LLM_PROVIDER": "vertex",
            "GEMINI_MODEL": "gemini-3-pro-preview",
            "QWEN_TEXT_MODEL": "qwen-text",
            "QWEN_SCORING_MODEL": "qwen-score",
        }, clear=False):
            self.assertEqual(scorer.get_scoring_llm_provider(), "qwen")
            self.assertEqual(scorer.get_text_model(), "qwen-score")

    def test_material_scoring_creates_qwen_client_even_when_global_provider_is_vertex(self):
        fake_client = object()
        with patch.dict(os.environ, {"LLM_PROVIDER": "vertex"}, clear=False), \
             patch.object(scorer, "create_llm_client", return_value=fake_client) as create_client:
            self.assertIs(scorer.create_scoring_llm_client(), fake_client)

        create_client.assert_called_once_with(provider="qwen")

    def test_parallel_batch_generation_is_routed_through_qwen_provider(self):
        captured_kwargs = []

        def fake_generate_content(_client, **kwargs):
            captured_kwargs.append(kwargs)
            return FakeResponse(json.dumps({
                "segments": [
                    {
                        "id": "seg-1",
                        "total_score": 80,
                        "reason": "ok",
                    }
                ]
            }, ensure_ascii=False))

        segment = {
            "id": "seg-1",
            "duration_sec": 3,
            "text": "hello",
        }

        with patch.dict(os.environ, {
            "LLM_PROVIDER": "vertex",
            "MATERIAL_SCORING_LLM_BATCH_SIZE": "1",
            "MATERIAL_SCORING_MAX_WORKERS": "1",
        }, clear=False), \
             patch.object(scorer, "generate_content", side_effect=fake_generate_content):
            result = scorer.score_segments_with_llm(
                [segment],
                object(),
                "qwen-score",
                allow_rule_fallback=False,
            )

        self.assertEqual(result["batch_errors"], [])
        self.assertEqual(captured_kwargs[0]["provider"], "qwen")
        self.assertEqual(captured_kwargs[0]["response_mime_type"], "application/json")


if __name__ == "__main__":
    unittest.main()
