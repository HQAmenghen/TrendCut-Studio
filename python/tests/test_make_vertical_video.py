import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
PIPELINE_ROOT = PYTHON_ROOT / "pipeline"
for candidate in (PROJECT_ROOT, PYTHON_ROOT, PIPELINE_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from pipeline.make_vertical_video import wrap_text  # noqa: E402


class FakeFont:
    def getbbox(self, text, **_kwargs):
        return (0, 0, len(str(text).strip()), 1)


class SubtitleWrappingTest(unittest.TestCase):
    def test_short_tail_wraps_without_ellipsis_when_two_lines_are_available(self):
        text = "就像中本聪把一百万枚比特币留给了宇宙。"

        wrapped = wrap_text(None, text, FakeFont(), max_width=18, max_lines=2)

        self.assertNotIn("...", wrapped)
        self.assertEqual(wrapped.replace("\n", ""), text)


if __name__ == "__main__":
    unittest.main()
