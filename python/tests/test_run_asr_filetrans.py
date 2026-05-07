import json
import os
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

from pipeline import run_asr  # noqa: E402


class QwenFiletransAsrTest(unittest.TestCase):
    def test_parse_filetrans_result_uses_sentence_times_and_word_times(self):
        payload = {
            "output": {
                "results": [
                    {
                        "transcription_url": "https://example.com/result.json",
                        "transcription": {
                            "transcripts": [
                                {
                                    "channel_id": 0,
                                    "text": "第一句话。第二句话。",
                                    "sentences": [
                                        {
                                            "begin_time": 120,
                                            "end_time": 1640,
                                            "text": "第一句话。",
                                            "words": [
                                                {"begin_time": 120, "end_time": 500, "text": "第一"},
                                                {"begin_time": 500, "end_time": 1640, "text": "句话。"},
                                            ],
                                        },
                                        {
                                            "begin_time": 1640,
                                            "end_time": 3210,
                                            "text": "第二句话。",
                                            "words": [
                                                {"begin_time": 1640, "end_time": 2200, "text": "第二"},
                                                {"begin_time": 2200, "end_time": 3210, "text": "句话。"},
                                            ],
                                        },
                                    ],
                                }
                            ]
                        },
                    }
                ]
            }
        }

        segments, language = run_asr.parse_filetrans_result_segments(payload)

        self.assertEqual(language, "zh")
        self.assertEqual(
            segments,
            [
                {"start": 0.12, "end": 1.64, "text": "第一句话。"},
                {"start": 1.64, "end": 3.21, "text": "第二句话。"},
            ],
        )

    def test_parse_filetrans_result_supports_top_level_transcripts_shape(self):
        payload = {
            "transcripts": [
                {
                    "sentences": [
                        {"start_time": 0.0, "end_time": 2.4, "text": "Markets moved fast."},
                    ],
                    "language": "en",
                }
            ]
        }

        segments, language = run_asr.parse_filetrans_result_segments(payload)

        self.assertEqual(language, "en")
        self.assertEqual(segments, [{"start": 0.0, "end": 2.4, "text": "Markets moved fast."}])

    def test_expand_filetrans_transcription_urls_does_not_forward_dashscope_headers(self):
        result_url = "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.json?Signature=test"
        payload = {
            "output": {
                "results": [
                    {
                        "transcription_url": result_url,
                    }
                ]
            }
        }
        dashscope_headers = {
            "Authorization": "Bearer dashscope-token",
            "X-DashScope-Async": "enable",
        }

        with patch("pipeline.run_asr.fetch_json", return_value={"transcripts": []}) as fetch_json:
            run_asr.expand_filetrans_transcription_urls(payload, headers=dashscope_headers)

        fetch_json.assert_called_once_with(result_url)
        self.assertEqual(payload["output"]["results"][0]["transcription"], {"transcripts": []})

    def test_resolve_filetrans_file_url_uploads_local_audio_to_oss_when_enabled(self):
        class FakeBucket:
            def __init__(self):
                self.uploaded = None

            def put_object_from_file(self, object_key, local_file):
                self.uploaded = (object_key, local_file)

            def sign_url(self, method, object_key, expires):
                return f"https://signed.example.com/{object_key}?method={method}&expires={expires}"

        fake_bucket = FakeBucket()
        env = {
            "ALIYUN_OSS_ENABLED": "true",
            "ALIYUN_OSS_BUCKET": "asr-aiman",
            "ALIYUN_OSS_ENDPOINT": "https://oss-cn-chengdu.aliyuncs.com",
            "ALIYUN_OSS_ACCESS_KEY_ID": "test-ak",
            "ALIYUN_OSS_ACCESS_KEY_SECRET": "test-sk",
            "ALIYUN_OSS_PREFIX": "comfy-panel/asr/",
            "ALIYUN_OSS_SIGNED_URL_EXPIRES_SECONDS": "600",
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            audio_file = Path(tmpdir) / "news_audio.mp3"
            audio_file.write_bytes(b"audio")

            with patch.dict(run_asr.os.environ, env, clear=False), \
                    patch("pipeline.run_asr.create_oss_bucket", return_value=fake_bucket):
                file_url, object_key = run_asr.resolve_filetrans_file_url(str(audio_file), "")

        self.assertTrue(file_url.startswith("https://signed.example.com/comfy-panel/asr/"))
        self.assertIn("news_audio", file_url)
        self.assertIn("expires=600", file_url)
        self.assertIsNotNone(object_key)
        self.assertEqual(fake_bucket.uploaded, (object_key, str(audio_file)))

    def test_main_writes_raw_asr_outputs_without_text_llm_postprocessing(self):
        def fake_extract_audio(_cmd, **_kwargs):
            Path("source_audio.mp3").write_bytes(b"audio")
            return type("CompletedProcess", (), {"returncode": 0})()

        raw_segments = [
            {"start": 0.0, "end": 2.5, "text": "Bitcoin is quiet."},
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            input_video = tmp_path / "source.mp4"
            input_video.write_bytes(b"video")
            old_cwd = os.getcwd()
            os.chdir(tmp_path)
            try:
                argv = [
                    "run_asr.py",
                    "--input", str(input_video),
                    "--audio-json", "audio.json",
                    "--subtitles-json", "subtitles.json",
                    "--speaker-scene-json", "speaker_scene.json",
                ]
                with patch.object(run_asr.sys, "argv", argv), \
                        patch.dict(run_asr.os.environ, {"LLM_PROVIDER": "qwen", "QWEN_API_KEY": "test-key"}, clear=False), \
                        patch("pipeline.run_asr.video_has_audio_stream", return_value=True), \
                        patch("pipeline.run_asr.subprocess.run", side_effect=fake_extract_audio), \
                        patch("pipeline.run_asr.build_raw_segments_aliyun", return_value=(raw_segments, "en")), \
                        patch("pipeline.run_asr.create_text_llm_runtime", side_effect=AssertionError("text LLM should not run"), create=True) as create_text_llm_runtime, \
                        patch("pipeline.run_asr.emit_stage"), \
                        patch("pipeline.run_asr.emit_result"):
                    run_asr.main()
            finally:
                os.chdir(old_cwd)

            audio = json.loads((tmp_path / "audio.json").read_text(encoding="utf-8"))
            subtitles = json.loads((tmp_path / "subtitles.json").read_text(encoding="utf-8"))
            speaker_scene = json.loads((tmp_path / "speaker_scene.json").read_text(encoding="utf-8"))

        create_text_llm_runtime.assert_not_called()
        self.assertEqual(audio, [{"start": 0.0, "end": 2.5, "text": "Bitcoin is quiet."}])
        self.assertEqual(
            subtitles,
            [{"time": [0.0, 2.5], "zh": "Bitcoin is quiet.", "en": "Bitcoin is quiet.", "text": "Bitcoin is quiet."}],
        )
        self.assertEqual(speaker_scene["participant_count"], 1)


if __name__ == "__main__":
    unittest.main()
