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

from pipeline.make_vertical_video import (  # noqa: E402
    clamp_subtitle_timeline_for_render,
    get_text_llm_provider,
    normalize_subtitles_for_display,
    prepare_subtitles_for_render,
    repair_english_spacing,
    split_long_subtitles,
    wrap_text,
)


class FakeFont:
    def getbbox(self, text, **_kwargs):
        return (0, 0, len(str(text).strip()), 1)


class SubtitleWrappingTest(unittest.TestCase):
    def test_short_tail_wraps_without_ellipsis_when_two_lines_are_available(self):
        text = "就像中本聪把一百万枚比特币留给了宇宙。"

        wrapped = wrap_text(None, text, FakeFont(), max_width=18, max_lines=2)

        self.assertNotIn("...", wrapped)
        self.assertEqual(wrapped.replace("\n", ""), text)

    def test_rebalance_preserves_english_word_spaces(self):
        text = "The CLARITY Act is the switch. Once the flywheel effect starts,"

        wrapped = wrap_text(None, text, FakeFont(), max_width=36, max_lines=2)

        self.assertIn("Once the", wrapped)
        self.assertNotIn("Oncethe", wrapped)

    def test_repairs_common_english_spacing_glitches(self):
        text = "Once the flywheel effect starts, it's far more than just the currentgains."

        repaired = repair_english_spacing(text)

        self.assertIn("Once the", repaired)
        self.assertIn("it's", repaired)
        self.assertIn("current gains", repaired)


class LlmProviderConfigTest(unittest.TestCase):
    def test_renderer_uses_text_llm_provider_from_project_environment(self):
        with patch.dict("os.environ", {"LLM_PROVIDER": "gemini", "TEXT_LLM_PROVIDER": "deepseek"}, clear=False):
            self.assertEqual(get_text_llm_provider(), "deepseek")


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

    def test_render_preparation_preserves_asr_grouped_subtitle_timing_by_default(self):
        subtitles = [
            {
                "time": [29.8, 33.9],
                "zh": "当然，参议院标记只是第一步，后续还要全院投票和众议院协调。",
                "en": "The Senate markup is only the first step.",
            },
            {
                "time": [33.9, 37.96],
                "zh": "但至少监管层在认真推进，加密行业终于盼来明确规则，",
                "en": "At least regulators are moving seriously.",
            },
        ]

        prepared = prepare_subtitles_for_render(subtitles)

        self.assertEqual([item["time"] for item in prepared], [[29.8, 33.9], [33.9, 37.96]])
        self.assertEqual([item["zh"] for item in prepared], [item["zh"] for item in subtitles])

    def test_render_preparation_only_splits_when_explicitly_requested(self):
        subtitles = [
            {
                "time": [0.0, 4.8],
                "zh": "OpenAI 发布了 20.5 美元的计划，Kalshi 也在跟进，这段字幕足够长但只有逗号。",
                "en": "OpenAI launched a 20.5 dollar plan, Kalshi followed along, and the subtitle stays intact.",
            }
        ]

        prepared = prepare_subtitles_for_render(subtitles, split_long=True)

        self.assertGreater(len(prepared), 1)
        self.assertEqual(prepared[0]["time"][0], 0.0)
        self.assertEqual(prepared[-1]["time"][1], 4.8)

    def test_render_clamps_overlapping_subtitle_windows(self):
        subtitles = [
            {"time": [3.0, 6.0], "zh": "后一张字幕不应该提前覆盖"},
            {"time": [1.0, 4.0], "zh": "前一张字幕"},
        ]

        clamped = clamp_subtitle_timeline_for_render(subtitles)

        self.assertEqual([item["zh"] for item in clamped], ["前一张字幕", "后一张字幕不应该提前覆盖"])
        self.assertEqual(clamped[0]["time"], [1.0, 3.0])
        self.assertEqual(clamped[1]["time"], [3.0, 6.0])


if __name__ == "__main__":
    unittest.main()
