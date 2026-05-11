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

from pipeline.make_vertical_video import normalize_subtitles_for_display, split_long_subtitles, wrap_text  # noqa: E402


class FakeFont:
    def getbbox(self, text, **_kwargs):
        return (0, 0, len(str(text).strip()), 1)


class SubtitleWrappingTest(unittest.TestCase):
    def test_short_tail_wraps_without_ellipsis_when_two_lines_are_available(self):
        text = "就像中本聪把一百万枚比特币留给了宇宙。"

        wrapped = wrap_text(None, text, FakeFont(), max_width=18, max_lines=2)

        self.assertNotIn("...", wrapped)
        self.assertEqual(wrapped.replace("\n", ""), text)


class SubtitleSplitTest(unittest.TestCase):
    def test_normalizes_traditional_chinese_before_rendering(self):
        subtitles = [
            {
                "time": [0.0, 2.0],
                "zh": "比特幣將突破100萬美元。",
                "text": "比特幣將突破100萬美元。",
                "en": "Bitcoin could reach 1 million dollars.",
            }
        ]

        normalized = normalize_subtitles_for_display(subtitles)

        self.assertEqual(normalized[0]["zh"], "比特币将突破100万美元。")
        self.assertEqual(normalized[0]["text"], "比特币将突破100万美元。")
        self.assertEqual(normalized[0]["en"], "Bitcoin could reach 1 million dollars.")
        self.assertEqual(subtitles[0]["zh"], "比特幣將突破100萬美元。")

    def test_splits_long_subtitles_on_safe_clause_commas(self):
        subtitles = [
            {
                "time": [0.0, 4.8],
                "zh": "OpenAI 发布了 20.5 美元的计划，Kalshi 也在跟进，这段字幕足够长但只有逗号。",
                "en": "OpenAI launched a 20.5 dollar plan, Kalshi followed along, and the subtitle stays intact.",
            }
        ]

        split = split_long_subtitles(subtitles, max_chars=18)

        self.assertEqual(len(split), 3)
        self.assertEqual(split[0]["zh"], "OpenAI 发布了 20.5 美元的计划，")
        self.assertEqual(split[1]["zh"], "Kalshi 也在跟进，")
        self.assertEqual(split[2]["zh"], "这段字幕足够长但只有逗号。")
        self.assertEqual(split[0]["time"][0], 0.0)
        self.assertEqual(split[-1]["time"][1], 4.8)

    def test_keeps_decimal_separator_inside_numeric_token(self):
        subtitles = [
            {
                "time": [0.0, 4.8],
                "zh": "关键价格是12.345美元，Kalshi数据没有被翻译成中文名称。",
                "en": "The key price is 12.345 dollars, and Kalshi is preserved.",
            }
        ]

        split = split_long_subtitles(subtitles, max_chars=18)

        self.assertEqual(len(split), 2)
        self.assertEqual(split[0]["zh"], "关键价格是12.345美元，")
        self.assertEqual(split[1]["zh"], "Kalshi数据没有被翻译成中文名称。")


if __name__ == "__main__":
    unittest.main()
