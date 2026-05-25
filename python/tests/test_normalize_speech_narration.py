import json
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

from pipeline import normalize_speech_narration  # noqa: E402


class NormalizeSpeechNarrationTest(unittest.TestCase):
    def test_deepseek_speech_model_prefers_specific_env(self):
        with patch.dict(os.environ, {
            "DEEPSEEK_SPEECH_MODEL": "deepseek-v4-flash",
            "DEEPSEEK_TEXT_MODEL": "deepseek-v4-pro",
        }, clear=False):
            self.assertEqual(normalize_speech_narration.get_deepseek_speech_model(), "deepseek-v4-flash")

    def test_extract_json_accepts_plain_json_and_code_fence(self):
        plain = normalize_speech_narration.extract_json(json.dumps({
            "speechText": "六万美元",
            "changes": []
        }, ensure_ascii=False))
        fenced = normalize_speech_narration.extract_json("""```json
{"speechText":"六万美元","changes":[]}
```""")

        self.assertEqual(plain["speechText"], "六万美元")
        self.assertEqual(fenced["speechText"], "六万美元")

    def test_validate_speech_text_rejects_unsafe_length(self):
        with self.assertRaises(ValueError):
            normalize_speech_narration.validate_speech_text("这是原文", "短")


if __name__ == "__main__":
    unittest.main()
