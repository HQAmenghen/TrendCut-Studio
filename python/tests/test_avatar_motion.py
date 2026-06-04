import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
for candidate in (PROJECT_ROOT, PYTHON_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from pipeline.avatar_motion_plan import (  # noqa: E402
    build_motion_plan,
    build_motion_plan_llm,
    build_llm_prompt,
    compile_motion_segments,
    extract_json_object_with_repair,
    parse_llm_assignments,
    resolve_audio_duration,
)
from pipeline.avatar_motion_source_builder import build_motion_source_video, load_video_templates  # noqa: E402


def write_action_meta(action_dir: Path, action_id: str, tags: list[str] | None = None) -> Path:
    action_path = action_dir / action_id
    action_path.mkdir(parents=True, exist_ok=True)
    (action_path / "action.json").write_text(json.dumps({
        "id": action_id,
        "duration": 1.0,
        "templateType": "video",
        "sourceVideo": "source.mp4",
        "sourceDuration": 0.6,
        "activeStart": 0.1,
        "activeEnd": 0.5,
        "entry": "neutral",
        "exit": "neutral",
        "tags": tags or [],
    }, ensure_ascii=False), encoding="utf-8")
    return action_path


class AvatarMotionPlanTest(unittest.TestCase):
    def test_uses_wav_duration_and_keyword_rules(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = Path(temp_dir) / "speech.wav"
            with wave.open(str(audio_path), "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(8000)
                wav_file.writeframes(b"\x00\x00" * 16000)

            duration = resolve_audio_duration(audio_path, "这才是关键。", 0)
            plan = build_motion_plan("这才是关键。普通说明。", duration, fps=25)

        self.assertAlmostEqual(duration, 2.0, places=2)
        self.assertEqual(plan["duration"], 2.0)
        self.assertEqual(plan["segments"][0]["action"], "right_hand_emphasis")
        self.assertEqual(plan["segments"][1]["action"], "idle_talking")
        self.assertTrue(plan["signature"])

    def test_resolve_audio_duration_ignores_untrusted_wav_header(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = Path(temp_dir) / "speech_bad_header.wav"
            sample_rate = 24000
            frames = b"\x00\x00" * sample_rate
            with audio_path.open("wb") as file_obj:
                file_obj.write(b"RIFF")
                file_obj.write((0x7fffffbf).to_bytes(4, "little"))
                file_obj.write(b"WAVEfmt ")
                file_obj.write((16).to_bytes(4, "little"))
                file_obj.write((1).to_bytes(2, "little"))
                file_obj.write((1).to_bytes(2, "little"))
                file_obj.write(sample_rate.to_bytes(4, "little"))
                file_obj.write((sample_rate * 2).to_bytes(4, "little"))
                file_obj.write((2).to_bytes(2, "little"))
                file_obj.write((16).to_bytes(2, "little"))
                file_obj.write(b"data")
                file_obj.write((0x7fffff9b).to_bytes(4, "little"))
                file_obj.write(frames)

            wave_duration = None
            with wave.open(str(audio_path), "rb") as wav_file:
                wave_duration = wav_file.getnframes() / float(wav_file.getframerate())

            duration = resolve_audio_duration(audio_path, "这才是关键。", 0)

        self.assertGreater(wave_duration, 40000)
        self.assertAlmostEqual(duration, 1.0, places=2)

    def test_semantic_matching_uses_multiple_available_actions(self):
        text = (
            "比特币一个奇特的现象：二零一八年出现某个买入信号后，价格涨了百分之一千七百。"
            "现在，这个信号第三次来了。"
            "这个所谓最佳买入区域，是结合链上指标和历史价格行为算出来的。"
            "前两次命中后都大幅上涨，这次信号出现在二零二六年。"
            "很多分析认为接下来比特币可能走抛物线式上涨，也就是加速冲高。"
            "不过每个周期宏观环境和资金结构都不一样。"
            "这个信号可以参考，但别当成下单的唯一依据。"
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            action_dir = Path(temp_dir) / "avatar_actions"
            write_action_meta(action_dir, "right_hand_emphasis", ["emphasis", "number"])
            write_action_meta(action_dir, "right_hand_open", ["explain", "indicator"])
            write_action_meta(action_dir, "both_hand_open", ["compare", "cycle"])
            write_action_meta(action_dir, "both_hand_emphasis", ["warning", "risk"])
            plan = build_motion_plan(text, 42.0, fps=25, action_dir=action_dir)
        actions = [segment["action"] for segment in plan["segments"] if segment["action"] != "idle_talking"]

        self.assertGreaterEqual(len(actions), 4)
        self.assertGreaterEqual(len(set(actions)), 3)
        self.assertIn("right_hand_emphasis", actions)
        self.assertIn("right_hand_open", actions)
        self.assertIn("both_hand_open", actions)
        self.assertEqual(plan["planner"]["method"], "local_sparse_semantic")

    def test_motion_plan_places_active_gesture_after_material_cutaway(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            action_dir = Path(temp_dir) / "avatar_actions"
            write_action_meta(action_dir, "right_hand_emphasis", ["emphasis", "number"])
            script_units = [
                {"id": "script_001", "role": "hook", "text": "这里有一个非常关键的信号，必须重点看。"}
            ]
            edit_plan = {
                "blocks": [
                    {
                        "id": "block_001",
                        "type": "evidence_clip",
                        "script_ref": "script_001",
                        "duration": 4.0,
                        "visual_layout": "cutaway_silent",
                        "use_cutaway": True,
                    }
                ]
            }
            plan = build_motion_plan(
                "这里有一个非常关键的信号，必须重点看。",
                8.0,
                fps=25,
                action_dir=action_dir,
                script_units=script_units,
                edit_plan=edit_plan,
            )

        action_segments = [segment for segment in plan["segments"] if segment["action"] != "idle_talking"]

        self.assertEqual(len(action_segments), 1)
        self.assertEqual(action_segments[0]["sourceSegmentId"], "script_001")
        self.assertGreaterEqual(action_segments[0]["timing"]["activeTimelineStart"], 4.0)
        self.assertLessEqual(action_segments[0]["timing"]["activeTimelineEnd"], 8.25)
        self.assertTrue(plan["planner"]["cutawayAware"])
        self.assertTrue(plan["planner"]["usesScriptUnits"])

    def test_motion_plan_uses_speech_alignment_anchor_for_active_gesture(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            action_dir = Path(temp_dir) / "avatar_actions"
            write_action_meta(action_dir, "right_hand_emphasis", ["emphasis", "number"])
            speech_alignment = {
                "segments": [
                    {
                        "id": "speech_001",
                        "start": 0.0,
                        "end": 6.0,
                        "text": "普通说明，这里有一个关键点，然后继续。"
                    }
                ],
                "words": [
                    {"start": 0.0, "end": 1.0, "text": "普通说明"},
                    {"start": 3.9, "end": 4.2, "text": "关键"},
                    {"start": 4.2, "end": 5.5, "text": "然后继续"},
                ],
            }
            plan = build_motion_plan(
                "普通说明，这里有一个关键点，然后继续。",
                6.0,
                fps=25,
                action_dir=action_dir,
                speech_alignment=speech_alignment,
            )

        action_segments = [segment for segment in plan["segments"] if segment["action"] != "idle_talking"]

        self.assertEqual(len(action_segments), 1)
        self.assertEqual(action_segments[0]["timing"]["targetSource"], "speech_alignment_anchor")
        self.assertLessEqual(action_segments[0]["timing"]["activeTimelineStart"], 4.05)
        self.assertGreaterEqual(action_segments[0]["timing"]["activeTimelineEnd"], 4.05)
        self.assertTrue(plan["planner"]["usesSpeechAlignment"])

    def test_llm_assignment_parser_preserves_timeline_and_applies_pacing(self):
        timeline = [
            {"id": "motion_001", "start": 0.0, "end": 2.0, "duration": 2.0, "text": "这是关键。"},
            {"id": "motion_002", "start": 2.0, "end": 4.0, "duration": 2.0, "text": "继续解释。"},
            {"id": "motion_003", "start": 5.2, "end": 7.2, "duration": 2.0, "text": "展开对比。"},
        ]
        profiles = {
            "right_hand_emphasis": {"intensity": 0.68},
            "both_hand_open": {"intensity": 0.58},
        }
        response = json.dumps({
            "segments": [
                {"id": "motion_001", "action": "right_hand_emphasis", "reason": "重点", "intensity": 0.7},
                {"id": "motion_002", "action": "both_hand_open", "reason": "太近", "intensity": 0.6},
                {"id": "motion_003", "action": "both_hand_open", "reason": "对比", "intensity": 0.6},
            ]
        }, ensure_ascii=False)

        segments = parse_llm_assignments(response, timeline, profiles)

        self.assertEqual(segments[0]["action"], "right_hand_emphasis")
        self.assertEqual(segments[1]["action"], "idle_talking")
        self.assertEqual(segments[1]["semantic"], "llm_cooldown_suppressed")
        self.assertEqual(segments[2]["action"], "both_hand_open")
        self.assertEqual(segments[2]["start"], 5.2)

    def test_llm_json_repair_retries_bad_json_with_llm(self):
        class FakeResponse:
            text = json.dumps({
                "segments": [
                    {"id": "motion_001", "action": "right_hand_emphasis", "reason": "重点", "intensity": 0.7}
                ]
            }, ensure_ascii=False)

        bad_json = '{"segments":[{"id":"motion_001","action":"right_hand_emphasis" "reason":"重点"}]}'

        with mock.patch("llm_client.generate_content", return_value=FakeResponse()) as generate_content:
            payload = extract_json_object_with_repair(
                bad_json,
                client=object(),
                expected_schema='{"segments":[]}',
            )

        self.assertEqual(payload["segments"][0]["action"], "right_hand_emphasis")
        self.assertEqual(generate_content.call_count, 1)

    def test_llm_assignment_uses_model_selected_word_anchor(self):
        timeline = [
            {
                "id": "motion_001",
                "start": 0.0,
                "end": 6.0,
                "duration": 6.0,
                "text": "普通说明，这里有一个关键点，然后继续。",
                "visibility": {
                    "avatarVisibleStart": 0.0,
                    "avatarVisibleEnd": 6.0,
                    "avatarVisibleDuration": 6.0,
                },
                "alignmentWords": [
                    {"index": 0, "start": 0.0, "end": 1.0, "text": "普通说明"},
                    {"index": 1, "start": 3.9, "end": 4.2, "text": "关键"},
                    {"index": 2, "start": 4.2, "end": 5.5, "text": "然后继续"},
                ],
            }
        ]
        profiles = {
            "right_hand_emphasis": {
                "intensity": 0.68,
                "sourceDuration": 1.0,
                "activeStart": 0.1,
                "activeEnd": 0.5,
            },
        }
        response = json.dumps({
            "segments": [
                {
                    "id": "motion_001",
                    "action": "right_hand_emphasis",
                    "reason": "强调模型选择的关键锚词",
                    "intensity": 0.7,
                    "anchorWordIndex": 1,
                    "anchorTime": None,
                },
            ]
        }, ensure_ascii=False)

        decisions = parse_llm_assignments(response, timeline, profiles)
        segments = [
            segment for segment in compile_motion_segments(decisions, profiles, 6.0)
            if segment["action"] != "idle_talking"
        ]

        self.assertEqual(decisions[0]["anchor"]["source"], "llm_speech_alignment_anchor")
        self.assertEqual(decisions[0]["anchor"]["word"], "关键")
        self.assertEqual(segments[0]["timing"]["targetSource"], "llm_speech_alignment_anchor")
        self.assertLessEqual(segments[0]["timing"]["activeTimelineStart"], 4.05)
        self.assertGreaterEqual(segments[0]["timing"]["activeTimelineEnd"], 4.05)

    def test_llm_prompt_includes_timed_subtitles_and_edit_context(self):
        timeline = [
            {
                "id": "script_001",
                "start": 0.0,
                "end": 8.0,
                "duration": 8.0,
                "text": "素材先展示，然后数字人强调关键点。",
                "visibility": {
                    "avatarVisibleStart": 4.0,
                    "avatarVisibleEnd": 8.0,
                    "avatarVisibleDuration": 4.0,
                    "materialCutawayStart": 0.0,
                    "materialCutawayEnd": 4.0,
                },
                "alignmentWords": [
                    {"index": 2, "start": 4.9, "end": 5.2, "text": "关键"},
                ],
            }
        ]
        profiles = {
            "right_hand_emphasis": {
                "label": "右手强调",
                "tags": ["emphasis"],
                "sourceDuration": 1.0,
                "activeStart": 0.1,
                "activeEnd": 0.5,
            },
        }
        edit_plan = {
            "blocks": [
                {
                    "id": "block_001",
                    "type": "evidence_clip",
                    "script_ref": "script_001",
                    "duration": 4.0,
                    "visual_layout": "cutaway_silent",
                    "use_cutaway": True,
                }
            ]
        }
        speech_alignment = {
            "segments": [{"id": "script_001", "start": 0.0, "end": 8.0, "text": "素材先展示，然后数字人强调关键点。"}],
            "words": [{"index": 2, "start": 4.9, "end": 5.2, "text": "关键"}],
        }

        prompt = build_llm_prompt(timeline, profiles, edit_plan=edit_plan, speech_alignment=speech_alignment)

        self.assertIn('"timed_subtitles"', prompt)
        self.assertIn('"edit_context"', prompt)
        self.assertIn('"avatar_visibility_windows"', prompt)
        self.assertIn('"alignmentWords"', prompt)
        self.assertIn('"anchorWordIndex"', prompt)
        self.assertIn("素材插片覆盖", prompt)

    def test_llm_failure_stops_without_local_fallback(self):
        with mock.patch("llm_client.create_llm_client", return_value=object()), \
                mock.patch("llm_client.generate_content", side_effect=RuntimeError("deepseek unavailable")):
            with self.assertRaisesRegex(RuntimeError, "deepseek unavailable"):
                build_motion_plan_llm(
                    "这是关键。然后解释。最后提醒不要当成唯一依据。",
                    9.0,
                    fps=25,
                )

    def test_llm_motion_planner_uses_deepseek_v4_flash(self):
        response = type("Response", (), {
            "text": json.dumps({
                "segments": [
                    {
                        "id": "motion_001",
                        "action": "right_hand_emphasis",
                        "reason": "强调关键点",
                        "intensity": 0.7,
                    }
                ]
            }, ensure_ascii=False)
        })()
        with mock.patch("llm_client.create_llm_client", return_value=object()) as create_client, \
                mock.patch("llm_client.generate_content", return_value=response) as generate_content:
            plan = build_motion_plan_llm(
                "这是关键。",
                4.0,
                fps=25,
            )

        create_client.assert_called_once_with("deepseek")
        self.assertEqual(generate_content.call_args.kwargs["provider"], "deepseek")
        self.assertEqual(generate_content.call_args.kwargs["model"], "deepseek-v4-flash")
        self.assertEqual(plan["planner"]["provider"], "deepseek")
        self.assertEqual(plan["planner"]["model"], "deepseek-v4-flash")

    def test_llm_motion_planner_retries_when_visible_segments_are_all_idle(self):
        first_response = type("Response", (), {
            "text": json.dumps({
                "segments": [
                    {
                        "id": "motion_001",
                        "action": "idle_talking",
                        "reason": "上一轮过于保守",
                        "intensity": 0.25,
                    }
                ]
            }, ensure_ascii=False)
        })()
        review_response = type("Response", (), {
            "text": json.dumps({
                "segments": [
                    {
                        "id": "motion_001",
                        "action": "right_hand_emphasis",
                        "reason": "自检后确认关键点需要一个出镜动作",
                        "intensity": 0.68,
                    }
                ]
            }, ensure_ascii=False)
        })()
        with mock.patch("llm_client.create_llm_client", return_value=object()), \
                mock.patch("llm_client.generate_content", side_effect=[first_response, review_response]) as generate_content:
            plan = build_motion_plan_llm(
                "这是关键判断，适合在出镜时做一次强调。",
                6.0,
                fps=25,
            )

        actions = [segment["action"] for segment in plan["segments"] if segment["action"] != "idle_talking"]
        self.assertEqual(generate_content.call_count, 2)
        self.assertEqual(actions, ["right_hand_emphasis"])
        self.assertTrue(plan["planner"]["retriedIdleReview"])
        self.assertIn("上一轮输出", generate_content.call_args.kwargs["contents"])

    def test_llm_motion_planner_stops_when_idle_reviews_still_have_no_gestures(self):
        idle_response = type("Response", (), {
            "text": json.dumps({
                "segments": [
                    {
                        "id": "motion_001",
                        "action": "idle_talking",
                        "reason": "保守处理",
                        "intensity": 0.25,
                    }
                ]
            }, ensure_ascii=False)
        })()
        with mock.patch("llm_client.create_llm_client", return_value=object()), \
                mock.patch("llm_client.generate_content", side_effect=[
                    idle_response,
                    idle_response,
                    idle_response,
                    idle_response,
                    idle_response,
                ]) as generate_content:
            with self.assertRaisesRegex(ValueError, "强制匹配后仍未产出"):
                build_motion_plan_llm(
                    "这是关键判断，适合在出镜时做一次强调。",
                    6.0,
                    fps=25,
                )
        self.assertEqual(generate_content.call_count, 5)

    def test_llm_motion_planner_uses_forced_ai_match_for_two_actions(self):
        idle_response = type("Response", (), {
            "text": json.dumps({
                "segments": [
                    {
                        "id": "motion_001",
                        "action": "idle_talking",
                        "reason": "保守处理",
                        "intensity": 0.25,
                    },
                    {
                        "id": "motion_002",
                        "action": "idle_talking",
                        "reason": "保守处理",
                        "intensity": 0.25,
                    },
                ]
            }, ensure_ascii=False)
        })()
        forced_response = type("Response", (), {
            "text": json.dumps({
                "selected": [
                    {
                        "id": "motion_001",
                        "action": "right_hand_emphasis",
                        "reason": "强调关键判断",
                        "intensity": 0.68,
                    },
                    {
                        "id": "motion_002",
                        "action": "both_hand_open",
                        "reason": "展开解释原因",
                        "intensity": 0.58,
                    },
                ]
            }, ensure_ascii=False)
        })()
        with mock.patch("llm_client.create_llm_client", return_value=object()), \
                mock.patch("llm_client.generate_content", side_effect=[
                    idle_response,
                    idle_response,
                    idle_response,
                    forced_response,
                ]) as generate_content:
            plan = build_motion_plan_llm(
                "这是关键判断，需要明确强调。这里解释原因和背景，适合展开说明。",
                12.0,
                fps=25,
            )

        actions = [segment["action"] for segment in plan["segments"] if segment["action"] != "idle_talking"]
        self.assertGreaterEqual(len(actions), 2)
        self.assertIn("right_hand_emphasis", actions)
        self.assertIn("both_hand_open", actions)
        self.assertEqual(generate_content.call_count, 4)


class AvatarPoseBuilderTest(unittest.TestCase):
    def test_action_templates_are_valid_json(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            action_dir = Path(temp_dir) / "avatar_actions"
            write_action_meta(action_dir, "right_hand_emphasis", ["emphasis"])
            for json_path in action_dir.glob("*/*.json"):
                with self.subTest(json_path=json_path):
                    self.assertIsInstance(json.loads(json_path.read_text(encoding="utf-8")), dict)

    @unittest.skipIf(shutil.which("ffmpeg") is None, "ffmpeg is required for motion source video assembly")
    def test_builds_motion_source_video_from_video_templates_and_idle_image(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            action_dir = temp_path / "avatar_actions"
            action_path = write_action_meta(action_dir, "right_hand_emphasis", ["emphasis"])
            self.assertEqual(
                0,
                subprocess.run([
                    "ffmpeg",
                    "-v",
                    "error",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:s=320x240:d=0.6",
                    "-r",
                    "10",
                    "-pix_fmt",
                    "yuv420p",
                    str(action_path / "source.mp4"),
                ], check=False).returncode,
            )
            templates = load_video_templates(action_dir)
            plan = {
                "version": 1,
                "fps": 10,
                "duration": 1.0,
                "segments": [
                    {"duration": 0.4, "action": "idle_talking", "intensity": 0.3},
                    {"duration": 0.6, "action": "right_hand_emphasis", "intensity": 0.7},
                ],
            }
            idle_image = temp_path / "idle.png"
            self.assertEqual(
                0,
                subprocess.run([
                    "ffmpeg",
                    "-v",
                    "error",
                    "-y",
                    "-i",
                    str(action_path / "source.mp4"),
                    "-frames:v",
                    "1",
                    str(idle_image),
                ], check=False).returncode,
            )
            output_video = temp_path / "avatar_motion_source.mp4"
            manifest = build_motion_source_video(
                plan,
                templates,
                idle_image=idle_image,
                output_video=output_video,
                work_dir=temp_path / "segments",
                fps=10,
                width=320,
                height=480,
                target_duration=plan["duration"],
            )

            self.assertTrue(output_video.exists())
            self.assertEqual(manifest["inputType"], "motion_source_video")
            self.assertEqual(manifest["fitMode"], "cover")
            self.assertEqual(manifest["duration"], 1.0)
            self.assertGreaterEqual(manifest["rawDuration"], manifest["duration"])
            self.assertEqual(len(manifest["segments"]), 2)
            self.assertEqual(manifest["segments"][0]["kind"], "idle_image")
            self.assertEqual(manifest["segments"][1]["kind"], "template_video")
            self.assertEqual(manifest["segments"][1]["sourceStart"], 0.0)
            self.assertGreaterEqual(manifest["segments"][1]["duration"], 0.6)
            self.assertGreaterEqual(
                manifest["segments"][1]["duration"],
                manifest["segments"][1]["sourceDuration"],
            )


if __name__ == "__main__":
    unittest.main()
