import sys
import unittest
from pathlib import Path
from unittest import mock


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
for candidate in (PROJECT_ROOT, PYTHON_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from pipeline.skills.clip_selector import ClipSelectorSkill  # noqa: E402


def build_script_unit():
    return {
        "id": "script_001",
        "role": "hook",
        "text": "特朗普刚刚立下重磅承诺，要让美国成为世界比特币中心。总统亲自下场，这信号够不够强？",
        "evidence": {
            "insert_priority": "high",
            "must_match": {
                "persons": ["唐纳德·特朗普"],
                "orgs": [],
                "assets": ["Bitcoin", "加密货币"],
                "event_types": ["公开演讲"],
                "event_tags": ["战略承诺"],
                "polarity": "bullish",
            },
            "preferred_match": {
                "visual_types": ["中近景"],
                "speaker_on_screen": True,
            },
            "negative_constraints": {
                "forbid_persons": [],
                "forbid_visual_types": ["空镜头"],
                "forbid_polarity": ["bearish"],
            },
            "duration_hint": {
                "min": 2.0,
                "ideal": 3.0,
                "max": 3.8,
            },
        },
    }


def build_segment():
    return {
        "id": "seg_01",
        "start": 0.0,
        "end": 27.0,
        "duration_sec": 27.0,
        "text": "Trump stands behind a black podium, speaking into a microphone.",
        "source_audio_text": "",
        "visual_summary": "Trump stands behind a black podium with RSBN lower third.",
        "entities": {
            "persons": [{"name": "Donald Trump"}],
            "orgs": [{"name": "The Economic Club of New York"}, {"name": "RSBN"}],
            "institutions": [{"name": "The Economic Club of New York"}],
            "assets": [],
            "topics": [{"name": "Political Speech"}],
        },
        "speaker": {
            "speaker_name": "Donald Trump",
            "speaker_on_screen": True,
            "speaker_matchable": True,
        },
        "event": {
            "event_type": "speaker_commentary",
            "event_tags": ["public_speech", "podium"],
            "polarity": "na",
        },
        "visual": {
            "visual_type": "stage_speech",
            "visual_usability": 8.0,
            "subtitle_bar_present": True,
            "generic_broll_risk": 0.2,
        },
        "scores": {
            "visual_usability": 8.0,
            "position_suitability": {
                "opening": 8.0,
                "main": 5.0,
                "closing": 3.0,
            },
        },
        "evidence": {
            "evidence_strength": 4.0,
            "evidence_type": "speaker_quote",
        },
        "recommendation": {
            "recommended_duration_sec": {
                "min": 2.0,
                "ideal": 4.0,
                "max": 6.0,
            }
        },
    }


class ClipSelectorLocalizationTest(unittest.TestCase):
    def setUp(self):
        self.skill = ClipSelectorSkill()
        self.unit = build_script_unit()
        self.segment = build_segment()

    def test_rule_match_accepts_localized_speaker_evidence_for_stage_speech(self):
        result = self.skill._compute_rule_match(self.unit, self.segment, 0.3594)

        self.assertNotIn("person_mismatch", result["reject_reasons"])
        self.assertNotIn("event_type_mismatch", result["reject_reasons"])
        self.assertNotIn("polarity_conflict", result["reject_reasons"])
        self.assertGreater(result["scores"]["final_score"], 0.30)

    def test_run_selects_cutaway_when_only_candidate_is_localized_stage_speech(self):
        retrieval_result = {
            "by_script": {
                "script_001": [
                    {
                        "segment_id": "seg_01",
                        "cosine_similarity": 0.3594,
                        "vector_rank": 1,
                    }
                ]
            },
            "retrievals": [
                {
                    "script_ref": "script_001",
                    "candidates": [{"segment_id": "seg_01", "cosine_similarity": 0.3594, "vector_rank": 1}],
                }
            ],
        }

        with mock.patch(
            "pipeline.skills.clip_selector.StructuredVectorRetriever.retrieve",
            return_value=retrieval_result,
        ):
            result = self.skill.run(
                {
                    "script_units": [self.unit],
                    "material_segments": {"segments": [self.segment]},
                    "route": {"content_type": "fast_news"},
                    "editing_style": {"constraints": {"max_cutaway_count": 4}},
                }
            ).output

        self.assertEqual(len(result["clip_matches"]), 1)
        self.assertTrue(result["clip_matches"][0]["use_cutaway"])

    def test_recommended_duration_prefers_long_speaker_material_even_with_short_legacy_hints(self):
        duration = self.skill._recommended_duration(self.unit, self.segment)

        self.assertGreaterEqual(duration, 7.0)

    def test_run_keeps_high_priority_soft_mismatch_candidate_for_visual_stimulation(self):
        unit = build_script_unit()
        unit["evidence"]["must_match"]["persons"] = ["Alexis Ohanian"]
        unit["evidence"]["must_match"]["orgs"] = ["Reddit"]
        segment = build_segment()
        segment["entities"]["persons"] = [{"name": "Unknown Speaker"}]
        segment["entities"]["orgs"] = []
        segment["speaker"]["speaker_name"] = "未知嘉宾"
        retrieval_result = {
            "by_script": {
                "script_001": [
                    {
                        "segment_id": "seg_01",
                        "cosine_similarity": 0.8134,
                        "vector_rank": 1,
                    }
                ]
            },
            "retrievals": [
                {
                    "script_ref": "script_001",
                    "candidates": [{"segment_id": "seg_01", "cosine_similarity": 0.8134, "vector_rank": 1}],
                }
            ],
        }

        with mock.patch(
            "pipeline.skills.clip_selector.StructuredVectorRetriever.retrieve",
            return_value=retrieval_result,
        ):
            result = self.skill.run(
                {
                    "script_units": [unit],
                    "material_segments": {"segments": [segment]},
                    "route": {"content_type": "fast_news"},
                    "editing_style": {"constraints": {"max_cutaway_count": 8}},
                }
            ).output

        self.assertEqual(len(result["clip_matches"]), 1)
        self.assertTrue(result["clip_matches"][0]["use_cutaway"])
        self.assertIn("person_mismatch", result["clip_matches"][0]["reject_reasons"])

    def test_run_accepts_speaker_commentary_when_segment_has_speaker_quote_evidence(self):
        unit = build_script_unit()
        unit["text"] = "Michael Saylor said his stock crashed from 333 dollars to 42 cents, but he kept holding."
        unit["evidence"]["must_match"]["persons"] = ["Michael Saylor"]
        unit["evidence"]["must_match"]["assets"] = []
        unit["evidence"]["must_match"]["event_types"] = ["speaker_quote"]
        unit["evidence"]["must_match"]["event_tags"] = ["HODL", "暴跌"]
        unit["evidence"]["must_match"]["polarity"] = "na"

        segment = build_segment()
        segment["id"] = "seg_08"
        segment["start"] = 54.80
        segment["end"] = 61.76
        segment["duration_sec"] = 6.96
        segment["text"] = "My stock went from $333 a share to 42 cents a share."
        segment["entities"]["persons"] = []
        segment["entities"]["orgs"] = []
        segment["speaker"]["speaker_name"] = "Vivek4real"
        segment["event"]["event_type"] = "speaker_commentary"
        segment["event"]["event_tags"] = ["price_data", "historical_record"]
        segment["evidence"]["evidence_type"] = "speaker_quote"

        retrieval_result = {
            "by_script": {
                "script_001": [
                    {
                        "segment_id": "seg_08",
                        "cosine_similarity": 0.2002,
                        "vector_rank": 1,
                    }
                ]
            },
            "retrievals": [
                {
                    "script_ref": "script_001",
                    "candidates": [{"segment_id": "seg_08", "cosine_similarity": 0.2002, "vector_rank": 1}],
                }
            ],
        }

        with mock.patch(
            "pipeline.skills.clip_selector.StructuredVectorRetriever.retrieve",
            return_value=retrieval_result,
        ):
            result = self.skill.run(
                {
                    "script_units": [unit],
                    "material_segments": {"segments": [segment]},
                    "route": {"content_type": "fast_news"},
                    "editing_style": {"constraints": {"max_cutaway_count": 8}},
                }
            ).output

        match = result["clip_matches"][0]
        self.assertTrue(match["use_cutaway"])
        self.assertNotIn("event_type_mismatch", match["reject_reasons"])
        self.assertIn("person_mismatch", match["reject_reasons"])
        self.assertIn("event_tag_mismatch", match["reject_reasons"])


if __name__ == "__main__":
    unittest.main()
