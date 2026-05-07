import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
for candidate in (PROJECT_ROOT, PYTHON_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from pipeline.skills.editing_style_skill import EditingStyleSkill  # noqa: E402


class EditingStyleMaterialFirstTest(unittest.TestCase):
    def test_fast_news_targets_at_least_twenty_seconds_material_in_sixty_seconds(self):
        style = EditingStyleSkill().run({"route": {"content_type": "fast_news"}}).output
        constraints = style["constraints"]

        self.assertGreaterEqual(constraints["min_source_ratio"], 0.35)
        self.assertGreaterEqual(constraints["target_source_ratio"], 0.40)
        self.assertGreaterEqual(constraints["max_single_clip_sec"], 8.0)
        self.assertGreaterEqual(constraints["max_cutaway_count"], 8)


if __name__ == "__main__":
    unittest.main()
