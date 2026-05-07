import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
for candidate in (PROJECT_ROOT, PYTHON_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from pipeline.planner.edit_planner import build_edit_plan  # noqa: E402


class EditPlannerMaterialFirstTest(unittest.TestCase):
    def test_evidence_blocks_respect_material_first_minimum_duration(self):
        plan = build_edit_plan({
            "route": {"content_type": "fast_news"},
            "script": {
                "script_units": [
                    {
                        "id": "script_001",
                        "role": "hook",
                        "text": "这是一段需要素材刺激的开场口播。",
                    }
                ]
            },
            "avatar_segments": {
                "segments": [
                    {
                        "id": "avatar_segment_001",
                        "script_ref": "script_001",
                        "start": 0.0,
                        "end": 12.0,
                        "duration": 12.0,
                    }
                ]
            },
            "clip_matches": {
                "clip_matches": [
                    {
                        "script_ref": "script_001",
                        "segment_id": "seg_01",
                        "source_ref": "material.mp4",
                        "use_cutaway": True,
                        "recommended_duration": 3.0,
                    }
                ]
            },
            "editing_style": {
                "constraints": {
                    "min_single_clip_sec": 4.0,
                    "max_single_clip_sec": 8.0,
                },
                "role_layouts": {
                    "hook": "cutaway_silent",
                },
            },
        })

        self.assertEqual(plan["blocks"][0]["type"], "evidence_clip")
        self.assertGreaterEqual(plan["blocks"][0]["duration"], 4.0)

    def test_explain_cutaway_blocks_expand_to_six_seconds_minimum(self):
        plan = build_edit_plan({
            "route": {"content_type": "fast_news"},
            "script": {
                "script_units": [
                    {
                        "id": "script_001",
                        "role": "explain",
                        "text": "中段解释部分应该给素材更稳定的展示时间。",
                    }
                ]
            },
            "avatar_segments": {
                "segments": [
                    {
                        "id": "avatar_segment_001",
                        "script_ref": "script_001",
                        "start": 0.0,
                        "end": 12.0,
                        "duration": 12.0,
                    }
                ]
            },
            "clip_matches": {
                "clip_matches": [
                    {
                        "script_ref": "script_001",
                        "segment_id": "seg_01",
                        "source_ref": "material.mp4",
                        "use_cutaway": True,
                        "recommended_duration": 3.2,
                    }
                ]
            },
            "editing_style": {
                "constraints": {
                    "min_single_clip_sec": 4.0,
                    "min_explain_clip_sec": 6.0,
                    "max_single_clip_sec": 8.0,
                },
                "role_layouts": {
                    "explain": "cutaway_silent",
                },
            },
        })

        self.assertEqual(plan["blocks"][0]["type"], "evidence_clip")
        self.assertEqual(plan["blocks"][0]["role"], "explain")
        self.assertAlmostEqual(plan["blocks"][0]["duration"], 6.0, places=2)

    def test_explain_cutaway_blocks_keep_longer_recommended_duration(self):
        plan = build_edit_plan({
            "route": {"content_type": "fast_news"},
            "script": {
                "script_units": [
                    {
                        "id": "script_001",
                        "role": "explain",
                        "text": "如果中段素材本来就够强，可以保留更长展示。",
                    }
                ]
            },
            "avatar_segments": {
                "segments": [
                    {
                        "id": "avatar_segment_001",
                        "script_ref": "script_001",
                        "start": 0.0,
                        "end": 12.0,
                        "duration": 12.0,
                    }
                ]
            },
            "clip_matches": {
                "clip_matches": [
                    {
                        "script_ref": "script_001",
                        "segment_id": "seg_01",
                        "source_ref": "material.mp4",
                        "use_cutaway": True,
                        "recommended_duration": 7.2,
                    }
                ]
            },
            "editing_style": {
                "constraints": {
                    "min_single_clip_sec": 4.0,
                    "min_explain_clip_sec": 6.0,
                    "max_single_clip_sec": 8.0,
                },
                "role_layouts": {
                    "explain": "cutaway_silent",
                },
            },
        })

        self.assertEqual(plan["blocks"][0]["type"], "evidence_clip")
        self.assertEqual(plan["blocks"][0]["role"], "explain")
        self.assertAlmostEqual(plan["blocks"][0]["duration"], 7.2, places=2)


if __name__ == "__main__":
    unittest.main()
