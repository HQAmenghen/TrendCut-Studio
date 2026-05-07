import os
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

from llm_client import get_text_llm_provider  # noqa: E402
from pipeline import generate_title  # noqa: E402
from pipeline.skills import script_rewriter_skill  # noqa: E402
from publish import generate_publish_description  # noqa: E402


class TextLlmProviderTest(unittest.TestCase):
    def test_text_provider_can_use_vertex_while_global_provider_stays_qwen(self):
        with patch.dict(os.environ, {
            "LLM_PROVIDER": "qwen",
            "TEXT_LLM_PROVIDER": "vertex",
            "GEMINI_MODEL": "gemini-3.1-pro-preview",
            "PUBLISH_DESCRIPTION_GEMINI_MODEL": "gemini-2.5-pro",
            "QWEN_TEXT_MODEL": "qwen3.5-plus",
        }, clear=False):
            self.assertEqual(get_text_llm_provider(), "vertex")
            self.assertEqual(generate_title.get_text_model(), "gemini-3.1-pro-preview")
            self.assertEqual(generate_publish_description.get_publish_model(), "gemini-2.5-pro")
            self.assertEqual(script_rewriter_skill._get_script_provider(), "vertex")


if __name__ == "__main__":
    unittest.main()
