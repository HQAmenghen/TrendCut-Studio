import sys
import unittest
from pathlib import Path
from unittest import mock
import tempfile
import math
import json


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
for candidate in (PROJECT_ROOT, PYTHON_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from pipeline.smart_video_composer import SmartVideoComposer  # noqa: E402


class FakeClip:
    def __init__(self, width: int, height: int, label: str = "clip", duration: float = 3.0):
        self.w = width
        self.h = height
        self.label = label
        self.duration = duration


class FakeAudio:
    def __init__(self, loudness: float, label: str):
        self.loudness = loudness
        self.label = label


class SmartVideoComposerCanvasTest(unittest.TestCase):
    def setUp(self):
        self.composer = SmartVideoComposer.__new__(SmartVideoComposer)
        self.composer.target_width = 0
        self.composer.target_height = 0

    def test_resolve_canvas_size_prefers_landscape_4_3_output(self):
        clips = [
            FakeClip(768, 1024, "avatar-1"),
            FakeClip(768, 1024, "avatar-2"),
            FakeClip(640, 360, "material-1"),
        ]

        self.assertEqual(self.composer._resolve_canvas_size(clips), (480, 360))

    def test_fit_clip_to_canvas_preserves_full_portrait_avatar_on_landscape_canvas(self):
        def fake_resize(clip, width=None, height=None):
            return FakeClip(width or clip.w, height or clip.h, label=f"{clip.label}:resized", duration=clip.duration)

        def fake_crop(clip, x_center, y_center, width, height):
            return {
                "mode": "crop",
                "source": clip.label,
                "width": width,
                "height": height,
            }

        def fake_position(clip, position):
            return {
                "mode": "position",
                "source": clip.label,
                "width": clip.w,
                "height": clip.h,
                "position": position,
            }

        def fake_duration(clip, duration):
            clip.duration = duration
            return clip

        self.composer._resize_compat = fake_resize
        self.composer._crop_compat = fake_crop
        self.composer._position_compat = fake_position
        self.composer._set_duration_compat = fake_duration

        portrait_clip = FakeClip(768, 1024, "avatar")

        with mock.patch("pipeline.smart_video_composer.ColorClip") as color_clip_cls, mock.patch(
            "pipeline.smart_video_composer.CompositeVideoClip"
        ) as composite_cls:
            color_clip_cls.return_value = FakeClip(480, 360, "background", duration=portrait_clip.duration)
            composite_cls.side_effect = lambda clips, size=None: {
                "mode": "composite",
                "clips": clips,
                "size": size,
            }

            fitted = self.composer._fit_clip_to_canvas(portrait_clip, 480, 360)

        self.assertEqual(fitted["mode"], "composite")
        self.assertEqual(fitted["size"], (480, 360))


class SmartVideoComposerAudioPolicyTest(unittest.TestCase):
    def test_auto_bgm_is_enabled_by_default(self):
        with tempfile.TemporaryDirectory() as work_dir, mock.patch.dict("os.environ", {}, clear=False), mock.patch(
            "pipeline.smart_video_composer.VideoClipEngine"
        ), mock.patch("pipeline.smart_video_composer.AudioProcessor"):
            composer = SmartVideoComposer(work_dir)

        self.assertTrue(composer.auto_bgm_enabled)

    def test_auto_bgm_can_be_explicitly_disabled(self):
        with tempfile.TemporaryDirectory() as work_dir, mock.patch.dict(
            "os.environ", {"SMART_CLIP_AUTO_BGM_ENABLED": "0"}, clear=False
        ), mock.patch("pipeline.smart_video_composer.VideoClipEngine"), mock.patch(
            "pipeline.smart_video_composer.AudioProcessor"
        ):
            composer = SmartVideoComposer(work_dir)

        self.assertFalse(composer.auto_bgm_enabled)

    def test_negative_lufs_mix_settings_can_be_overridden_from_env(self):
        env = {
            "SMART_CLIP_BGM_MIN_LUFS": "-34.5",
            "SMART_CLIP_BGM_MAX_LUFS": "-21.5",
            "SMART_CLIP_VOICE_TARGET_LUFS": "-17.0",
            "SMART_CLIP_VOICE_MAX_BOOST_DB": "11.0",
        }
        with tempfile.TemporaryDirectory() as work_dir, mock.patch.dict("os.environ", env, clear=False), mock.patch(
            "pipeline.smart_video_composer.VideoClipEngine"
        ), mock.patch("pipeline.smart_video_composer.AudioProcessor"):
            composer = SmartVideoComposer(work_dir)

        self.assertEqual(composer.bgm_min_lufs, -34.5)
        self.assertEqual(composer.bgm_max_lufs, -21.5)
        self.assertEqual(composer.voice_target_lufs, -17.0)
        self.assertEqual(composer.voice_max_boost_db, 11.0)

    def test_default_voice_bgm_gap_keeps_music_audible_after_voice_boost(self):
        with tempfile.TemporaryDirectory() as work_dir, mock.patch.dict("os.environ", {}, clear=True), mock.patch(
            "pipeline.smart_video_composer.SmartVideoComposer._load_local_env_files"
        ), mock.patch("pipeline.smart_video_composer.VideoClipEngine"), mock.patch(
            "pipeline.smart_video_composer.AudioProcessor"
        ):
            composer = SmartVideoComposer(work_dir)

        def fake_volume(audio, factor):
            return FakeAudio(audio.loudness + (20 * math.log10(factor)), audio.label)

        composer._volume_audio_compat = fake_volume
        composer._analyze_clip_loudness = lambda audio, _temp_name: audio.loudness

        main_audio, bgm_audio = composer._build_priority_audio_mix(
            FakeAudio(-32.0, "voice"),
            FakeAudio(-20.0, "bgm"),
        )

        self.assertGreaterEqual(main_audio.loudness, -18.1)
        self.assertGreaterEqual(bgm_audio.loudness, main_audio.loudness - 12.0)

    def test_priority_audio_mix_raises_quiet_voice_before_ducking_bgm(self):
        composer = SmartVideoComposer.__new__(SmartVideoComposer)
        composer.voice_priority_boost_db = 3.0
        composer.voice_target_lufs = -16.0
        composer.voice_max_boost_db = 14.0
        composer.bgm_global_boost_db = 5.0
        composer.voice_bgm_gap_db = 15.0
        composer.bgm_min_lufs = -36.0
        composer.bgm_max_lufs = -19.0

        def fake_volume(audio, factor):
            return FakeAudio(audio.loudness + (20 * math.log10(factor)), audio.label)

        composer._volume_audio_compat = fake_volume
        composer._analyze_clip_loudness = lambda audio, _temp_name: audio.loudness

        main_audio, bgm_audio = composer._build_priority_audio_mix(
            FakeAudio(-32.0, "voice"),
            FakeAudio(-20.0, "bgm"),
        )

        self.assertGreaterEqual(main_audio.loudness, -18.1)
        self.assertLessEqual(bgm_audio.loudness, main_audio.loudness - 12.0)


class SmartVideoComposerCutawayGuardTest(unittest.TestCase):
    def test_compose_from_director_plan_fails_when_planned_cutaway_clip_fails(self):
        with tempfile.TemporaryDirectory() as work_dir:
            plan_path = Path(work_dir) / "execution_plan.json"
            plan_path.write_text(
                json.dumps([
                    {
                        "type": "aiman",
                        "start": 0,
                        "end": 1,
                        "duration": 1,
                    },
                    {
                        "type": "material_cutaway",
                        "start": 3,
                        "end": 7,
                        "duration": 4,
                        "material_cut_start": 3,
                        "material_cut_end": 7,
                    },
                ]),
                encoding="utf-8",
            )
            composer = SmartVideoComposer.__new__(SmartVideoComposer)
            composer.work_dir = Path(work_dir)

            def fake_clip(segment, _material_video, _aiman_video, _output_path):
                return segment.get("type") != "material_cutaway"

            composer._clip_segment_with_ost = fake_clip
            composer._compose_with_moviepy = mock.Mock(return_value=True)

            self.assertFalse(
                composer.compose_from_director_plan(
                    director_plan_path=str(plan_path),
                    material_video="material.mp4",
                    aiman_video="aiman.mp4",
                    output_path=str(Path(work_dir) / "output_final.mp4"),
                )
            )
            composer._compose_with_moviepy.assert_not_called()


if __name__ == "__main__":
    unittest.main()
