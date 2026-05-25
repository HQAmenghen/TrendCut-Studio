import sys
import tempfile
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
    append_outro,
    clamp_subtitle_timeline_for_render,
    close_active_audio_subtitle_gaps,
    get_text_llm_provider,
    normalize_subtitles_for_display,
    parse_silencedetect_ranges,
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


class OutroAppendTest(unittest.TestCase):
    def test_returns_false_when_no_outro_is_requested(self):
        self.assertFalse(append_outro(Path("output.mp4"), None))

    def test_appends_outro_with_silent_audio_fallback_for_mute_main_video(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "output.mp4"
            outro = Path(temp_dir) / "outro.mp4"
            output.write_bytes(b"main")
            outro.write_bytes(b"outro")

            def fake_run(cmd, check):
                Path(cmd[-1]).write_bytes(b"combined")

            with patch("pipeline.make_vertical_video.emit_stage") as emit_stage, \
                 patch("pipeline.make_vertical_video.probe_media", side_effect=[
                     {"duration": 2.5, "has_audio": False},
                     {"duration": 1.0, "has_audio": True},
                 ]), \
                 patch("pipeline.make_vertical_video.subprocess.run", side_effect=fake_run) as subprocess_run:

                appended = append_outro(output, outro)

            self.assertTrue(appended)
            emit_stage.assert_called_with("vertical_outro", "正在拼接自定义片尾")
            cmd = subprocess_run.call_args.args[0]
            self.assertIn("anullsrc=channel_layout=stereo:sample_rate=48000", cmd)
            filter_complex = cmd[cmd.index("-filter_complex") + 1]
            self.assertIn("[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]", filter_complex)
            self.assertEqual(Path(cmd[-1]).name, "output.with_outro.mp4")
            self.assertEqual(output.read_bytes(), b"combined")


class LlmProviderConfigTest(unittest.TestCase):
    def test_renderer_uses_text_llm_provider_from_project_environment(self):
        with patch.dict("os.environ", {"LLM_PROVIDER": "gemini", "TEXT_LLM_PROVIDER": "deepseek"}, clear=False):
            self.assertEqual(get_text_llm_provider(), "deepseek")


class SubtitleSplitTest(unittest.TestCase):
    def test_parses_silencedetect_ranges(self):
        output = """
        [silencedetect @ 000] silence_start: 13.2
        [silencedetect @ 000] silence_end: 13.91 | silence_duration: 0.71
        [silencedetect @ 000] silence_start: 22.5
        """

        ranges = parse_silencedetect_ranges(output, duration=24.0)

        self.assertEqual(ranges, [(13.2, 13.91), (22.5, 24.0)])

    def test_extends_previous_subtitle_gap_when_audio_is_active(self):
        subtitles = [
            {"time": [11.36, 13.2], "zh": "自由和分离货币与国家"},
            {"time": [15.84, 17.76], "zh": "稳定币常被宣传为生命线"},
        ]

        closed = close_active_audio_subtitle_gaps(subtitles, silence_ranges=[])

        self.assertEqual(closed[0]["time"], [11.36, 15.84])
        self.assertEqual(closed[1]["time"], [15.84, 17.76])

    def test_extends_previous_subtitle_across_long_active_audio_gap(self):
        subtitles = [
            {"time": [7.2, 10.8], "zh": "她指出上一次黄金风险如此之高"},
            {"time": [15.51, 21.52], "zh": "但她表示，当前并不处于那两种极端环境"},
        ]

        closed = close_active_audio_subtitle_gaps(subtitles, silence_ranges=[])

        self.assertEqual(closed[0]["time"], [7.2, 15.51])
        self.assertEqual(closed[1]["time"], [15.51, 21.52])

    def test_preserves_internal_subtitle_gap_when_audio_is_silent(self):
        subtitles = [
            {"time": [11.36, 13.2], "zh": "自由和分离货币与国家"},
            {"time": [15.84, 17.76], "zh": "稳定币常被宣传为生命线"},
        ]

        closed = close_active_audio_subtitle_gaps(subtitles, silence_ranges=[(13.18, 15.9)])

        self.assertEqual([item["time"] for item in closed], [[11.36, 13.2], [15.84, 17.76]])

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

    def test_normalizes_decimal_million_display_before_rendering(self):
        subtitles = [
            {
                "time": [0.0, 2.0],
                "zh": "触及1.5百万美元之前。",
                "text": "别只盯着1.5百万这个价格。",
            }
        ]

        normalized = normalize_subtitles_for_display(subtitles)

        self.assertEqual(normalized[0]["zh"], "触及150万美元之前。")
        self.assertEqual(normalized[0]["text"], "别只盯着150万这个价格。")

    def test_preserves_large_chinese_unit_display_before_rendering(self):
        subtitles = [
            {
                "time": [0.0, 2.0],
                "zh": "资产规模约3.5万亿美元。",
                "text": "资产规模约3.5万亿美元。",
            }
        ]

        normalized = normalize_subtitles_for_display(subtitles)

        self.assertEqual(normalized[0]["zh"], "资产规模约3.5万亿美元。")
        self.assertEqual(normalized[0]["text"], "资产规模约3.5万亿美元。")

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
