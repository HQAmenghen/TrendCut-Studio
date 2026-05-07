import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
for candidate in (PROJECT_ROOT, PYTHON_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from pipeline.run_material_driven import MaterialDrivenPipeline  # noqa: E402
from pipeline.skills.base import SkillResult  # noqa: E402


class MaterialDrivenPipelineReuseTest(unittest.TestCase):
    def test_step2_passes_material_url_to_asr_filetrans(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            (output_dir / "material.mp4").write_text("video", encoding="utf-8")
            (output_dir / "source_post.json").write_text(
                json.dumps({"materialUrl": "https://cdn.example.com/news.mp4"}, ensure_ascii=False),
                encoding="utf-8",
            )
            pipeline = MaterialDrivenPipeline(
                material_path=str(output_dir / "material.mp4"),
                output_dir=str(output_dir),
            )
            calls = []

            class FakeProc:
                def wait(self):
                    return 0

            def fake_run_script_async(script_name, args=None, cwd=None):
                calls.append((script_name, list(args or []), cwd))
                if script_name == "run_asr.py":
                    (output_dir / "audio.json").write_text("[]", encoding="utf-8")
                if script_name == "video_vlm.py":
                    (output_dir / "result.json").write_text("{}", encoding="utf-8")
                return FakeProc()

            with patch.object(pipeline, "_run_script_async", side_effect=fake_run_script_async):
                self.assertTrue(pipeline.step2_analyze_material())

            asr_args = next(args for script_name, args, _cwd in calls if script_name == "run_asr.py")
            self.assertIn("--file-url", asr_args)
            self.assertEqual(asr_args[asr_args.index("--file-url") + 1], "https://cdn.example.com/news.mp4")

    def test_tail_silence_detection_returns_precise_effective_duration(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            pipeline = MaterialDrivenPipeline(
                material_path=str(output_dir / "material.mp4"),
                output_dir=str(output_dir),
            )
            silence_log = "\n".join([
                "[silencedetect] silence_start: 19.535782",
                "[silencedetect] silence_end: 19.768571 | silence_duration: 0.232789",
                "[silencedetect] silence_start: 52.636372",
                "[silencedetect] silence_end: 54.427574 | silence_duration: 1.791202",
            ])

            meta = pipeline.resolve_avatar_effective_duration_from_silence_log(
                media_duration=54.44,
                silence_log=silence_log,
            )

            self.assertTrue(meta["trimmed"])
            self.assertAlmostEqual(meta["effective_duration"], 52.72, places=2)
            self.assertAlmostEqual(meta["tail_silence_seconds"], 1.79, places=2)

    def test_tail_silence_detection_ignores_short_or_non_terminal_silence(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            pipeline = MaterialDrivenPipeline(
                material_path=str(output_dir / "material.mp4"),
                output_dir=str(output_dir),
            )
            silence_log = "\n".join([
                "[silencedetect] silence_start: 10.0",
                "[silencedetect] silence_end: 11.0 | silence_duration: 1.0",
                "[silencedetect] silence_start: 54.20",
                "[silencedetect] silence_end: 54.44 | silence_duration: 0.24",
            ])

            meta = pipeline.resolve_avatar_effective_duration_from_silence_log(
                media_duration=54.44,
                silence_log=silence_log,
            )

            self.assertFalse(meta["trimmed"])
            self.assertAlmostEqual(meta["effective_duration"], 54.44, places=2)

    def test_reuse_mode_refuses_to_rewrite_incompatible_existing_script(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            script_payload = {
                "script_units": [
                    {
                        "id": "script_001",
                        "role": "hook",
                        "text": "旧任务口播稿",
                    }
                ]
            }
            (output_dir / "script_units.json").write_text(
                json.dumps(script_payload, ensure_ascii=False),
                encoding="utf-8",
            )
            (output_dir / "source_post.json").write_text(
                json.dumps({"title": "当前任务原帖"}, ensure_ascii=False),
                encoding="utf-8",
            )
            (output_dir / "content_outline.json").write_text(
                json.dumps({"segments": []}, ensure_ascii=False),
                encoding="utf-8",
            )
            (output_dir / "audio.json").write_text("[]", encoding="utf-8")
            (output_dir / "selected_segments.json").write_text("[]", encoding="utf-8")

            pipeline = MaterialDrivenPipeline(
                material_path=str(output_dir / "material.mp4"),
                output_dir=str(output_dir),
            )

            with patch(
                "pipeline.run_material_driven.ScriptRewriterSkill.is_script_context_compatible",
                return_value=False,
            ), patch(
                "pipeline.run_material_driven.ScriptRewriterSkill.run",
                side_effect=AssertionError("reuse mode must not rewrite script_units"),
            ):
                self.assertFalse(pipeline.generate_edit_plan(reuse_scripts=True))

    def _write_minimal_inputs(self, output_dir: Path):
        (output_dir / "source_post.json").write_text(
            json.dumps(
                {
                    "title": "BlackRock 的 Jay Jacobs 表示，比特币提供投资组合价值",
                    "body": "BlackRock's Jay Jacobs tells Fox Business Bitcoin provides portfolio value.",
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        (output_dir / "content_outline.json").write_text(
            json.dumps(
                {
                    "target_duration_sec": 45,
                    "segments": [{"id": "seg_1", "summary": "比特币提供投资组合价值。"}],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        (output_dir / "audio.json").write_text(
            json.dumps([{"start": 0, "end": 3, "text": "比特币提供投资组合价值。"}], ensure_ascii=False),
            encoding="utf-8",
        )
        (output_dir / "selected_segments.json").write_text(
            json.dumps({"segments": [{"id": "seg_1", "text": "比特币提供投资组合价值。"}]}, ensure_ascii=False),
            encoding="utf-8",
        )
        (output_dir / "material_segments_scored.json").write_text(
            json.dumps({"segments": []}, ensure_ascii=False),
            encoding="utf-8",
        )

    def test_generate_edit_plan_uses_polished_script_units_and_writes_artifact(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            self._write_minimal_inputs(output_dir)
            draft_units = [{"id": "script_001", "unit_id": 1, "role": "hook", "text": "首稿口播"}]
            polished_units = [{"id": "script_001", "unit_id": 1, "role": "hook", "text": "优化后口播"}]

            pipeline = MaterialDrivenPipeline(
                material_path=str(output_dir / "material.mp4"),
                output_dir=str(output_dir),
            )

            def copywriting_run(_self, payload):
                self.assertEqual(payload["script_units"], polished_units)
                return SkillResult(
                    skill="copywriting_skill",
                    output={"guidance": {}, "script_units": payload["script_units"]},
                    meta={"status": "ready"},
                )

            with patch(
                "pipeline.run_material_driven.ContentRouterSkill.run",
                return_value=SkillResult(skill="content_router", output={"content_type": "fast_news"}, meta={"status": "ready"}),
            ), patch(
                "pipeline.run_material_driven.ScriptRewriterSkill.run",
                return_value=SkillResult(
                    skill="script_rewriter_skill",
                    output={"script_units": draft_units},
                    meta={"status": "ready", "decision_mode": "llm_rewrite", "provider": "qwen", "model": "draft-model", "source_anchor": {"has_source_anchor": True}},
                ),
            ), patch(
                "pipeline.run_material_driven.ScriptPolisherSkill.run",
                return_value=SkillResult(
                    skill="script_polisher_skill",
                    output={"script_units": polished_units, "decision_meta": {"model": "polish-model"}},
                    meta={"status": "ready", "decision_mode": "llm_polish", "provider": "qwen", "model": "polish-model", "char_count": 190},
                ),
            ) as polisher_run, patch(
                "pipeline.run_material_driven.CopywritingSkill.run",
                new=copywriting_run,
            ), patch(
                "pipeline.run_material_driven.EditingStyleSkill.run",
                return_value=SkillResult(skill="editing_style", output={"style_id": "test"}, meta={"status": "ready"}),
            ), patch(
                "pipeline.run_material_driven.ClipSelectorSkill.run",
                return_value=SkillResult(
                    skill="clip_selector",
                    output={"matches": [], "decision_meta": {"provider": "qwen", "model": "test-model"}},
                    meta={"status": "ready"},
                ),
            ), patch(
                "pipeline.run_material_driven.build_edit_plan",
                return_value={"meta": {}},
            ):
                self.assertTrue(pipeline.generate_edit_plan())

            self.assertEqual(polisher_run.call_count, 1)
            script_payload = json.loads((output_dir / "script_units.json").read_text(encoding="utf-8"))
            self.assertEqual(script_payload["script_units"], polished_units)
            self.assertTrue((output_dir / "script_polisher_skill.json").exists())

    def test_reuse_mode_does_not_call_script_polisher(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            self._write_minimal_inputs(output_dir)
            existing_units = [{"id": "script_001", "unit_id": 1, "role": "hook", "text": "已通过校验的口播"}]
            (output_dir / "script_units.json").write_text(
                json.dumps({"script_units": existing_units}, ensure_ascii=False),
                encoding="utf-8",
            )

            pipeline = MaterialDrivenPipeline(
                material_path=str(output_dir / "material.mp4"),
                output_dir=str(output_dir),
            )

            with patch(
                "pipeline.run_material_driven.ContentRouterSkill.run",
                return_value=SkillResult(skill="content_router", output={"content_type": "fast_news"}, meta={"status": "ready"}),
            ), patch(
                "pipeline.run_material_driven.ScriptRewriterSkill.is_script_context_compatible",
                return_value=True,
            ), patch(
                "pipeline.run_material_driven.ScriptPolisherSkill.run",
                side_effect=AssertionError("reuse mode must not call ScriptPolisherSkill"),
            ), patch(
                "pipeline.run_material_driven.CopywritingSkill.run",
                return_value=SkillResult(skill="copywriting_skill", output={"guidance": {}, "script_units": existing_units}, meta={"status": "ready"}),
            ), patch(
                "pipeline.run_material_driven.EditingStyleSkill.run",
                return_value=SkillResult(skill="editing_style", output={"style_id": "test"}, meta={"status": "ready"}),
            ), patch(
                "pipeline.run_material_driven.ClipSelectorSkill.run",
                return_value=SkillResult(
                    skill="clip_selector",
                    output={"matches": [], "decision_meta": {"provider": "qwen", "model": "test-model"}},
                    meta={"status": "ready"},
                ),
            ), patch(
                "pipeline.run_material_driven.build_edit_plan",
                return_value={"meta": {}},
            ):
                self.assertTrue(pipeline.generate_edit_plan(reuse_scripts=True))

    def test_execution_plan_expands_short_matched_cutaway_to_minimum_duration(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            (output_dir / "script_units.json").write_text(
                json.dumps(
                    {
                        "script_units": [
                            {
                                "id": "script_001",
                                "role": "hook",
                                "text": "白宫提名人明确表态，美联储无权发行CBDC。",
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (output_dir / "avatar_segments.json").write_text(
                json.dumps(
                    {
                        "segments": [
                            {
                                "id": "avatar_segment_001",
                                "script_ref": "script_001",
                                "start": 0,
                                "end": 8.54,
                                "duration": 8.54,
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (output_dir / "edit_plan.json").write_text(
                json.dumps(
                    {
                        "constraints": {
                            "min_single_clip_sec": 4.0,
                            "min_hook_clip_sec": 4.5,
                            "max_single_clip_sec": 8.0,
                        },
                        "blocks": [
                            {
                                "id": "block_001",
                                "type": "evidence_clip",
                                "duration": 4.5,
                                "source_ref": "material.mp4",
                                "script_ref": "script_001",
                                "visual_layout": "cutaway_silent",
                                "role": "hook",
                                "text": "白宫提名人明确表态，美联储无权发行CBDC。",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (output_dir / "selected_segments.json").write_text(
                json.dumps(
                    {
                        "segments": [
                            {
                                "id": "seg_short",
                                "start": 6.18,
                                "end": 8.0,
                                "duration_sec": 1.82,
                                "text": "参议员，我同意他们没有这个权力。",
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (output_dir / "material_segments_scored.json").write_text(
                json.dumps({"segments": []}, ensure_ascii=False),
                encoding="utf-8",
            )
            (output_dir / "clip_matches.json").write_text(
                json.dumps(
                    {
                        "clip_matches": [
                            {
                                "script_ref": "script_001",
                                "segment_id": "seg_short",
                                "material_cut_start": 6.18,
                                "material_cut_end": 8.0,
                                "recommended_duration": 1.82,
                                "use_cutaway": True,
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            pipeline = MaterialDrivenPipeline(
                material_path=str(output_dir / "material.mp4"),
                output_dir=str(output_dir),
            )

            with patch.object(pipeline, "get_video_duration", return_value=32.5):
                self.assertTrue(pipeline.build_execution_plan_from_edit_plan())

            plan = json.loads((output_dir / "execution_plan.json").read_text(encoding="utf-8"))
            self.assertEqual(plan[0]["type"], "material_cutaway")
            self.assertAlmostEqual(plan[0]["duration"], 4.5, places=2)
            self.assertAlmostEqual(plan[0]["start"], 6.18, places=2)
            self.assertAlmostEqual(plan[0]["end"], 10.68, places=2)

    def test_execution_plan_expands_explain_cutaway_to_six_seconds_minimum(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            (output_dir / "script_units.json").write_text(
                json.dumps(
                    {
                        "script_units": [
                            {
                                "id": "script_001",
                                "role": "explain",
                                "text": "中段解释部分的素材镜头要稳定至少六秒。",
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (output_dir / "avatar_segments.json").write_text(
                json.dumps(
                    {
                        "segments": [
                            {
                                "id": "avatar_segment_001",
                                "script_ref": "script_001",
                                "start": 0,
                                "end": 11.2,
                                "duration": 11.2,
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (output_dir / "edit_plan.json").write_text(
                json.dumps(
                    {
                        "constraints": {
                            "min_single_clip_sec": 4.0,
                            "min_hook_clip_sec": 4.5,
                            "min_explain_clip_sec": 6.0,
                            "max_single_clip_sec": 8.0,
                        },
                        "blocks": [
                            {
                                "id": "block_001",
                                "type": "evidence_clip",
                                "duration": 3.4,
                                "source_ref": "material.mp4",
                                "script_ref": "script_001",
                                "visual_layout": "cutaway_silent",
                                "role": "explain",
                                "text": "中段解释部分的素材镜头要稳定至少六秒。",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (output_dir / "selected_segments.json").write_text(
                json.dumps(
                    {
                        "segments": [
                            {
                                "id": "seg_short",
                                "start": 12.5,
                                "end": 14.1,
                                "duration_sec": 1.6,
                                "text": "这是素材中的关键证据画面。",
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (output_dir / "material_segments_scored.json").write_text(
                json.dumps({"segments": []}, ensure_ascii=False),
                encoding="utf-8",
            )
            (output_dir / "clip_matches.json").write_text(
                json.dumps(
                    {
                        "clip_matches": [
                            {
                                "script_ref": "script_001",
                                "segment_id": "seg_short",
                                "material_cut_start": 12.5,
                                "material_cut_end": 14.1,
                                "recommended_duration": 1.6,
                                "use_cutaway": True,
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            pipeline = MaterialDrivenPipeline(
                material_path=str(output_dir / "material.mp4"),
                output_dir=str(output_dir),
            )

            with patch.object(pipeline, "get_video_duration", return_value=40.0):
                self.assertTrue(pipeline.build_execution_plan_from_edit_plan())

            plan = json.loads((output_dir / "execution_plan.json").read_text(encoding="utf-8"))
            self.assertEqual(plan[0]["type"], "material_cutaway")
            self.assertAlmostEqual(plan[0]["duration"], 6.0, places=2)
            self.assertAlmostEqual(plan[0]["start"], 12.5, places=2)
            self.assertAlmostEqual(plan[0]["end"], 18.5, places=2)


if __name__ == "__main__":
    unittest.main()
