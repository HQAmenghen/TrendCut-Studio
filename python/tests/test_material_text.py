import sys
import unittest
from pathlib import Path


PYTHON_ROOT = Path(__file__).resolve().parents[1]
python_root_str = str(PYTHON_ROOT)
if python_root_str not in sys.path:
    sys.path.insert(0, python_root_str)

from pipeline import material_text


class MaterialTextTest(unittest.TestCase):
    def test_normalize_sentence_text_repairs_common_spacing_and_punctuation(self):
        self.assertEqual(material_text.normalize_sentence_text("这 些 内容，。"), "这些 内容。")

    def test_estimate_duration_uses_visible_text_floor(self):
        self.assertEqual(material_text.estimate_duration_from_text(""), 1.8)
        self.assertEqual(material_text.estimate_duration_from_text("短句", min_duration=2.0), 2.0)

    def test_split_text_into_semantic_groups_preserves_sentence_text(self):
        groups = material_text.split_text_into_semantic_groups(
            "第一句。第二句。第三句。第四句。第五句。",
            target_groups=2,
        )

        self.assertEqual("".join(groups), "第一句。第二句。第三句。第四句。第五句。")
        self.assertLessEqual(len(groups), 2)


if __name__ == "__main__":
    unittest.main()
