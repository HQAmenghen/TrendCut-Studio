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
    def setUp(self):
        super().setUp()
        debug_patch = patch("pipeline.run_asr.append_reference_authority_debug_event")
        debug_patch.start()
        self.addCleanup(debug_patch.stop)

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

    def test_sentence_text_reconstructs_filetrans_english_words_with_spaces(self):
        sentence = {
            "text": "Whensomebodyisusingtheinternet,isitacrime?",
            "words": [
                {"text": "When"},
                {"text": "somebody"},
                {"text": "is"},
                {"text": "using"},
                {"text": "the"},
                {"text": "internet", "punctuation": ","},
                {"text": "is"},
                {"text": "it"},
                {"text": "a"},
                {"text": "crime", "punctuation": "?"},
            ],
        }

        self.assertEqual(
            run_asr.sentence_text(sentence),
            "When somebody is using the internet, is it a crime?",
        )

    def test_sentence_text_keeps_filetrans_chinese_words_compact(self):
        sentence = {
            "words": [
                {"text": "第一"},
                {"text": "句话", "punctuation": "。"},
            ],
        }

        self.assertEqual(run_asr.sentence_text(sentence), "第一句话。")

    def test_parse_filetrans_result_can_include_word_times_for_internal_splitting(self):
        payload = {
            "transcripts": [
                {
                    "sentences": [
                        {
                            "begin_time": 0,
                            "end_time": 2000,
                            "text": "第一句，第二句。",
                            "words": [
                                {"begin_time": 0, "end_time": 800, "text": "第一句，"},
                                {"begin_time": 800, "end_time": 2000, "text": "第二句。"},
                            ],
                        },
                    ],
                    "language": "zh",
                }
            ]
        }

        segments, language = run_asr.parse_filetrans_result_segments(payload, include_words=True)

        self.assertEqual(language, "zh")
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0]["text"], "第一句，第二句。")
        self.assertEqual([(word.start, word.end, word.word) for word in segments[0]["words"]], [
            (0.0, 0.8, "第一句，"),
            (0.8, 2.0, "第二句。"),
        ])

    def test_split_filetrans_segments_splits_long_clause_sentence(self):
        raw_segments = [
            {
                "start": 0.0,
                "end": 6.0,
                "text": "第一句，第二句，第三句。",
            }
        ]

        chunks = run_asr.split_filetrans_segments(raw_segments)

        self.assertEqual(
            chunks,
            [
                {"start": 0.0, "end": 2.0, "text": "第一句，"},
                {"start": 2.0, "end": 4.0, "text": "第二句，"},
                {"start": 4.0, "end": 6.0, "text": "第三句。"},
            ],
        )

    def test_build_raw_segments_filetrans_splits_single_sentence_by_word_punctuation(self):
        payload = {
            "transcripts": [
                {
                    "language": "zh",
                    "sentences": [
                        {
                            "begin_time": 0,
                            "end_time": 6000,
                            "text": "一只股票从333美元跌到0.42美元，跌幅99.8%，几乎归零。",
                            "words": [
                                {
                                    "begin_time": 0,
                                    "end_time": 2000,
                                    "text": "一只股票从333美元跌到0.42美元",
                                    "punctuation": "，",
                                },
                                {
                                    "begin_time": 2000,
                                    "end_time": 4000,
                                    "text": "跌幅99.8%",
                                    "punctuation": "，",
                                },
                                {
                                    "begin_time": 4000,
                                    "end_time": 6000,
                                    "text": "几乎归零",
                                    "punctuation": "。",
                                },
                            ],
                        },
                    ],
                }
            ]
        }

        with patch("pipeline.run_asr.submit_qwen_filetrans_task", return_value=("task-id", {})), \
                patch("pipeline.run_asr.wait_qwen_filetrans_task", return_value=payload), \
                patch("pipeline.run_asr.expand_filetrans_transcription_urls", side_effect=lambda data, headers=None: data), \
                patch("pipeline.run_asr.emit_stage"):
            segments, language = run_asr.build_raw_segments_filetrans("https://example.com/audio.mp3")

        self.assertEqual(language, "zh")
        self.assertEqual(
            segments,
            [
                {"start": 0.0, "end": 2.0, "text": "一只股票从333美元跌到0.42美元，"},
                {"start": 2.0, "end": 4.0, "text": "跌幅99.8%，"},
                {"start": 4.0, "end": 6.0, "text": "几乎归零。"},
            ],
        )

    def test_split_filetrans_segments_does_not_split_decimal_values(self):
        raw_segments = [
            {
                "start": 0.0,
                "end": 4.0,
                "text": "关键价格是12.345美元，目标不变。",
            }
        ]

        chunks = run_asr.split_filetrans_segments(raw_segments)

        self.assertEqual(len(chunks), 2)
        self.assertEqual(chunks[0]["text"], "关键价格是12.345美元，")
        self.assertEqual(chunks[1]["text"], "目标不变。")

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

    def test_localhost_urls_are_not_treated_as_public_filetrans_urls(self):
        self.assertFalse(run_asr.is_public_http_url("http://localhost:3001/projects/task/output_final.mp4"))
        self.assertFalse(run_asr.is_public_http_url("http://127.0.0.1:3001/video.mp4"))
        self.assertFalse(run_asr.is_public_http_url("http://192.168.1.10/video.mp4"))
        self.assertTrue(run_asr.is_public_http_url("https://cdn.example.com/video.mp4"))

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
                        patch("pipeline.run_asr.create_llm_client", side_effect=AssertionError("text LLM should not run")) as create_text_llm_runtime, \
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

    def test_main_backfills_chinese_subtitles_when_requested(self):
        def fake_extract_audio(_cmd, **_kwargs):
            Path("source_audio.mp3").write_bytes(b"audio")
            return type("CompletedProcess", (), {"returncode": 0})()

        raw_segments = [
            {"start": 0.0, "end": 2.5, "text": "Bitcoin is quiet."},
        ]

        class FakeResponse:
            text = json.dumps([{"index": 0, "zh": "比特币很平静。"}], ensure_ascii=False)

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
                    "--translate-subtitles",
                ]
                with patch.object(run_asr.sys, "argv", argv), \
                        patch.dict(run_asr.os.environ, {"LLM_PROVIDER": "qwen", "QWEN_API_KEY": "test-key"}, clear=False), \
                        patch("pipeline.run_asr.video_has_audio_stream", return_value=True), \
                        patch("pipeline.run_asr.subprocess.run", side_effect=fake_extract_audio), \
                        patch("pipeline.run_asr.build_raw_segments_aliyun", return_value=(raw_segments, "en")), \
                        patch("pipeline.run_asr.create_llm_client", return_value=object()) as create_client, \
                        patch("pipeline.run_asr.generate_content", return_value=FakeResponse()) as generate_content, \
                        patch("pipeline.run_asr.emit_stage"), \
                        patch("pipeline.run_asr.emit_result"):
                    run_asr.main()
            finally:
                os.chdir(old_cwd)

            subtitles = json.loads((tmp_path / "subtitles.json").read_text(encoding="utf-8"))

        create_client.assert_called_once()
        generate_content.assert_called_once()
        self.assertEqual(
            subtitles,
            [{"time": [0.0, 2.5], "zh": "比特币很平静。", "en": "Bitcoin is quiet.", "text": "Bitcoin is quiet."}],
        )

    def test_build_raw_subtitles_normalizes_traditional_chinese_asr(self):
        raw_segments = [
            {
                "start": 0.0,
                "end": 2.5,
                "text": "比特幣2032年將突破100萬美元。",
            },
            {
                "start": 2.5,
                "end": 5.0,
                "text": "多數人還在門外，機構資金持續湧入。",
            },
        ]

        subtitles = run_asr.build_raw_subtitles(raw_segments, "zh")

        self.assertEqual(
            subtitles,
            [
                {
                    "time": [0.0, 2.5],
                    "zh": "比特币2032年将突破100万美元。",
                    "en": "",
                    "text": "比特币2032年将突破100万美元。",
                },
                {
                    "time": [2.5, 5.0],
                    "zh": "多数人还在门外，机构资金持续涌入。",
                    "en": "",
                    "text": "多数人还在门外，机构资金持续涌入。",
                },
            ],
        )

    def test_read_reference_subtitles_normalizes_traditional_chinese(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            reference_path = Path(tmpdir) / "reference.json"
            reference_path.write_text(
                json.dumps([
                    {
                        "time": [0.0, 2.5],
                        "zh": "這個穩定幣法案通過後，機構資金會湧入。",
                    }
                ], ensure_ascii=False),
                encoding="utf-8",
            )

            reference = run_asr.read_reference_subtitles(str(reference_path))

        self.assertEqual(reference[0]["zh"], "这个稳定币法案通过后，机构资金会涌入。")
        self.assertEqual(reference[0]["text"], "这个稳定币法案通过后，机构资金会涌入。")

    def test_backfill_normalizes_existing_chinese_without_llm(self):
        subtitles = [
            {
                "time": [0.0, 2.5],
                "zh": "這個比特幣配置是關鍵。",
                "text": "這個比特幣配置是關鍵。",
            }
        ]

        with patch("pipeline.run_asr.create_llm_client", side_effect=AssertionError("text LLM should not run")) as create_client:
            normalized = run_asr.backfill_chinese_subtitles(subtitles, "zh")

        create_client.assert_not_called()
        self.assertEqual(normalized[0]["zh"], "这个比特币配置是关键。")
        self.assertEqual(normalized[0]["text"], "这个比特币配置是关键。")

    def test_refine_subtitles_with_llm_preserves_timing_and_normalizes_text(self):
        subtitles = [
            {
                "time": [0.0, 2.5],
                "zh": "比特幣2032年將突破100萬美元",
                "en": "",
                "text": "比特幣2032年將突破100萬美元",
            }
        ]

        class FakeResponse:
            text = json.dumps([
                {
                    "index": 0,
                    "time": [0.0, 2.5],
                    "zh": "比特幣2032年將突破100萬美元。",
                    "en": "Bitcoin will break one million dollars by 2032.",
                }
            ], ensure_ascii=False)

        with patch("pipeline.run_asr.create_llm_client", return_value=object()) as create_client, \
                patch("pipeline.run_asr.generate_content", return_value=FakeResponse()) as generate_content, \
                patch("pipeline.run_asr.emit_stage"):
            refined = run_asr.refine_subtitles_with_llm(subtitles, "zh")

        create_client.assert_called_once()
        generate_content.assert_called_once()
        prompt = generate_content.call_args.kwargs["contents"]
        self.assertIn('"placeholders"', prompt)
        self.assertIn("普通英文单词", prompt)
        self.assertIn("稳定通用中文译名", prompt)
        self.assertIn("孤立单字母", prompt)
        self.assertIn("单个拉丁字母", prompt)
        self.assertEqual(refined[0]["time"], [0.0, 2.5])
        self.assertEqual(refined[0]["zh"], "比特币2032年将突破100万美元。")
        self.assertEqual(refined[0]["text"], refined[0]["zh"])
        self.assertEqual(refined[0]["en"], "Bitcoin will break one million dollars by 2032.")

    def test_main_aligns_asr_timing_with_reference_subtitles(self):
        def fake_extract_audio(_cmd, **_kwargs):
            Path("source_audio.mp3").write_bytes(b"audio")
            return type("CompletedProcess", (), {"returncode": 0})()

        raw_segments = [
            {"start": 0.0, "end": 2.5, "text": "Kalshi volume is moving."},
        ]

        class FakeResponse:
            text = json.dumps([
                {
                    "index": 0,
                    "time": [0.0, 2.5],
                    "zh": "Kalshi 的成交量在波动。",
                    "en": "Kalshi volume is moving.",
                }
            ], ensure_ascii=False)

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            input_video = tmp_path / "source.mp4"
            input_video.write_bytes(b"video")
            reference_path = tmp_path / "reference.json"
            reference_path.write_text(
                json.dumps([
                    {"time": [0.0, 2.5], "zh": "Kalshi 的成交量在波动。", "en": "Kalshi volume is moving."}
                ], ensure_ascii=False),
                encoding="utf-8",
            )
            old_cwd = os.getcwd()
            os.chdir(tmp_path)
            try:
                argv = [
                    "run_asr.py",
                    "--input", str(input_video),
                    "--audio-json", "audio.json",
                    "--subtitles-json", "subtitles.json",
                    "--speaker-scene-json", "speaker_scene.json",
                    "--reference-subtitles-json", str(reference_path),
                ]
                with patch.object(run_asr.sys, "argv", argv), \
                        patch.dict(run_asr.os.environ, {"LLM_PROVIDER": "qwen", "QWEN_API_KEY": "test-key"}, clear=False), \
                        patch("pipeline.run_asr.video_has_audio_stream", return_value=True), \
                        patch("pipeline.run_asr.subprocess.run", side_effect=fake_extract_audio), \
                        patch("pipeline.run_asr.build_raw_segments_aliyun", return_value=(raw_segments, "en")), \
                        patch("pipeline.run_asr.create_llm_client", return_value=object()) as create_client, \
                        patch("pipeline.run_asr.generate_content", return_value=FakeResponse()) as generate_content, \
                        patch("pipeline.run_asr.emit_stage"), \
                        patch("pipeline.run_asr.emit_result"):
                    run_asr.main()
            finally:
                os.chdir(old_cwd)

            subtitles = json.loads((tmp_path / "subtitles.json").read_text(encoding="utf-8"))

        create_client.assert_called_once()
        generate_content.assert_called_once()
        self.assertEqual(
            subtitles,
            [{"time": [0.0, 2.5], "zh": "Kalshi 的成交量在波动。", "en": "Kalshi volume is moving.", "text": "Kalshi 的成交量在波动。"}],
        )

    def test_reference_alignment_repairs_partial_person_name_from_llm_output(self):
        subtitles = [
            {
                "time": [12.64, 18.2],
                "zh": "过去大家以为比特币是传家宝。但Phong在采访里说得很直接。",
                "en": "But Phong said directly in an interview.",
                "text": "过去大家以为比特币是传家宝。但Phong在采访里说得很直接。",
            },
        ]
        reference = [
            {
                "time": [12.64, 22.17],
                "zh": "过去大家以为比特币是传家宝。但Phong Le在采访里说得很直接：只要卖比特币能让每股价值更优，就会卖。",
            },
        ]

        class FakeResponse:
            text = json.dumps([
                {
                    "index": 0,
                    "time": [12.64, 18.2],
                    "zh": "过去大家以为比特币是传家宝。但Phong在采访里说得很直接。",
                    "en": "But Phong said directly in an interview.",
                }
            ], ensure_ascii=False)

        with patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", return_value=FakeResponse()), \
                patch("pipeline.run_asr.emit_stage"):
            aligned = run_asr.align_subtitles_with_reference(subtitles, reference)

        self.assertEqual(aligned[0]["zh"], "过去大家以为比特币是传家宝。但Phong Le在采访里说得很直接。")
        self.assertEqual(aligned[0]["en"], "But Phong Le said directly in an interview.")
        self.assertEqual(aligned[0]["text"], aligned[0]["zh"])

    def test_reference_alignment_normalizes_traditional_llm_output(self):
        subtitles = [
            {
                "time": [0.0, 2.5],
                "zh": "比特币配置正在扩大。",
                "en": "",
                "text": "比特币配置正在扩大。",
            },
        ]
        reference = [
            {
                "time": [0.0, 2.5],
                "zh": "比特币配置正在扩大，机构资金持续涌入。",
            }
        ]

        class FakeResponse:
            text = json.dumps([
                {
                    "index": 0,
                    "time": [0.0, 2.5],
                    "zh": "比特幣配置正在擴大，機構資金持續湧入。",
                    "en": "",
                }
            ], ensure_ascii=False)

        with patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", return_value=FakeResponse()), \
                patch("pipeline.run_asr.emit_stage"):
            aligned = run_asr.align_subtitles_with_reference(subtitles, reference)

        self.assertEqual(aligned[0]["zh"], "比特币配置正在扩大，机构资金持续涌入。")
        self.assertEqual(aligned[0]["text"], aligned[0]["zh"])

    def test_merge_reference_continuations_combines_orphan_chinese_character(self):
        subtitles = [
            {
                "time": [15.3, 18.1],
                "zh": "69%说明参与者普遍认为立法会落",
                "en": "69% indicates participants believe legislation will land",
                "text": "69%说明参与者普遍认为立法会落",
            },
            {
                "time": [18.1, 18.28],
                "zh": "地",
                "en": "enacted",
                "text": "地",
            },
            {
                "time": [18.28, 20.58],
                "zh": "再结合视频里那位政客的承诺",
                "en": "combined with the politician's promise in the video",
                "text": "再结合视频里那位政客的承诺",
            },
        ]
        reference = [
            {
                "time": [10.02, 24.39],
                "zh": "很多人觉得这只是预测模型，但Kalshi是用真金白银投票。69%说明参与者普遍认为立法会落地。再结合视频里那位政客的承诺——今年签署里程碑式法案——信号很一致",
            }
        ]

        merged = run_asr.merge_reference_continuations(subtitles, reference)

        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[0]["time"], [15.3, 18.28])
        self.assertEqual(merged[0]["zh"], "69%说明参与者普遍认为立法会落地")
        self.assertEqual(merged[0]["text"], "69%说明参与者普遍认为立法会落地")
        self.assertEqual(merged[0]["en"], "69% indicates participants believe legislation will land")
        self.assertEqual(merged[1]["zh"], "再结合视频里那位政客的承诺")

    def test_select_reference_context_for_asr_prefers_matching_clause_window(self):
        reference_text = (
            "一只股票从333美元跌到0.42美元，跌幅99.8%，几乎归零。"
            "Michael Saylor亲自经历了这一切，但他选择死扛到底。"
        )

        self.assertEqual(
            run_asr.select_reference_context_for_asr(
                reference_text,
                "一只股票从三$3~3跌到$0.42，"
            ),
            "一只股票从333美元跌到0.42美元，",
        )
        self.assertEqual(
            run_asr.select_reference_context_for_asr(
                reference_text,
                "幅99.8%，几乎归零。"
            ),
            "跌幅99.8%，几乎归零。",
        )

    def test_repair_subtitles_with_reference_terms_restores_missing_numeric_target(self):
        subtitles = [
            {
                "time": [2.24, 5.12],
                "zh": "昨晚放出惊人预测：比特币将达到",
                "text": "昨晚放出惊人预测：比特币将达到",
            },
            {
                "time": [5.12, 7.6],
                "zh": "美元将走向消亡。",
                "text": "美元将走向消亡。",
            },
        ]
        reference = [
            {
                "time": [0.0, 9.81],
                "zh": "亿万富翁Tim Draper昨晚放出惊人预测：比特币将达到1000万美元，美元将走向消亡。",
            }
        ]

        repaired = run_asr.repair_subtitles_with_reference_terms(subtitles, reference)

        self.assertEqual(repaired[0]["zh"], "昨晚放出惊人预测：比特币将达到1000万美元，")
        self.assertEqual(repaired[0]["text"], repaired[0]["zh"])
        self.assertEqual(repaired[1]["zh"], "美元将走向消亡。")

    def test_repair_subtitles_with_reference_terms_restores_english_scale_amount(self):
        subtitles = [
            {
                "time": [4.12, 7.12],
                "zh": "他们每小时买入200的比特币",
                "en": "They buy $200 million worth of Bitcoin every hour",
                "text": "他们每小时买入200的比特币",
            },
        ]
        reference = [
            {
                "time": [0.0, 13.64],
                "zh": "MicroStrategy的CEO Michael Saylor在采访中透露，他们每小时买入200 million美元的比特币，但价格几乎没波动。",
            }
        ]

        repaired = run_asr.repair_subtitles_with_reference_terms(subtitles, reference)

        self.assertEqual(repaired[0]["zh"], "他们每小时买入200 million美元的比特币")
        self.assertEqual(repaired[0]["text"], repaired[0]["zh"])

    def test_repair_subtitles_with_reference_terms_restores_claude_proper_nouns(self):
        subtitles = [
            {
                "time": [0.16, 1.12],
                "zh": "云端AI",
                "en": "Cloud AI",
                "text": "云端AI",
            },
            {
                "time": [1.12, 2.32],
                "zh": "在 Code with Cloud",
                "en": "At Code with Cloud",
                "text": "在 Code with Cloud",
            },
        ]
        reference = [
            {
                "time": [0.0, 10.08],
                "zh": (
                    "Claude AI 在 Code with Claude 活动上给开发者发了批巴掌大的微型电脑，"
                    "结果他们捣鼓出的东西还真挺有意思"
                ),
            }
        ]

        repaired = run_asr.repair_subtitles_with_reference_terms(subtitles, reference)

        self.assertEqual(repaired[0]["zh"], "Claude AI")
        self.assertEqual(repaired[0]["text"], repaired[0]["zh"])
        self.assertEqual(repaired[0]["en"], "Claude AI")
        self.assertEqual(repaired[1]["zh"], "在 Code with Claude")
        self.assertEqual(repaired[1]["text"], repaired[1]["zh"])
        self.assertEqual(repaired[1]["en"], "At Code with Claude")

    def test_normalize_final_subtitles_drops_zero_duration_fragments(self):
        subtitles = [
            {
                "time": [5.56, 8.46],
                "zh": "美联储决策层里多了一个懂比特币的人",
                "en": "There is one more person in the Fed's decision-making circle who understands Bitcoin",
                "text": "美联储决策层里多了一个懂比特币的人",
            },
            {
                "time": [7.82, 7.82],
                "zh": "the United Nations who understands",
                "en": "",
                "text": "the United Nations who understands",
            },
        ]

        normalized = run_asr.normalize_final_subtitles(subtitles)

        self.assertEqual(len(normalized), 1)
        self.assertEqual(normalized[0]["zh"], "美联储决策层里多了一个懂比特币的人")

    def test_merge_reference_continuations_combines_split_decimal_token(self):
        subtitles = [
            {"time": [0.0, 1.0], "zh": "关键价格是12.", "text": "关键价格是12."},
            {"time": [1.0, 1.2], "zh": "345美元", "text": "345美元"},
        ]
        reference = [{"time": [0.0, 1.2], "zh": "关键价格是12.345美元"}]

        merged = run_asr.merge_reference_continuations(subtitles, reference)

        self.assertEqual(
            merged,
            [{"time": [0.0, 1.2], "zh": "关键价格是12.345美元", "text": "关键价格是12.345美元"}],
        )

    def test_merge_reference_continuations_does_not_merge_after_decimal_inside_previous_clause(self):
        subtitles = [
            {
                "time": [0.0, 2.0],
                "zh": "一只股票从333美元跌到0.42美元，",
                "text": "一只股票从333美元跌到0.42美元，",
            },
            {
                "time": [2.0, 4.0],
                "zh": "跌幅99.8%，",
                "text": "跌幅99.8%，",
            },
            {
                "time": [4.0, 6.0],
                "zh": "几乎归零。",
                "text": "几乎归零。",
            },
        ]
        reference = [{
            "time": [0.0, 6.0],
            "zh": "一只股票从333美元跌到0.42美元，跌幅99.8%，几乎归零。",
        }]

        merged = run_asr.merge_reference_continuations(subtitles, reference)

        self.assertEqual(merged, subtitles)

    def test_merge_reference_continuations_trims_generic_duplicate_prefix(self):
        subtitles = [
            {
                "time": [16.24, 19.04],
                "zh": "他这番玩笑，其实是在调侃加密圈里人人都想当预言家，",
                "en": "His joke is actually teasing that everyone in the crypto circle wants to be a prophet,",
                "text": "他这番玩笑，其实是在调侃加密圈里人人都想当预言家，",
            },
            {
                "time": [19.04, 22.0],
                "zh": "想当预言家，但没人愿意为失误负责。",
                "en": "want to be a prophet, but no one is willing to take responsibility for mistakes.",
                "text": "想当预言家，但没人愿意为失误负责。",
            },
        ]
        reference = [{
            "time": [8.15, 21.5],
            "zh": "Consensus可是全球顶级加密峰会，Don Jr作为政治家族成员现身，本身就自带流量。他这番玩笑，其实是在调侃加密圈里人人都想当预言家，但没人愿意为失误负责的生态",
        }]

        merged = run_asr.merge_reference_continuations(subtitles, reference)

        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[1]["zh"], "但没人愿意为失误负责。")
        self.assertEqual(merged[1]["text"], "但没人愿意为失误负责。")
        self.assertEqual(merged[1]["en"], "but no one is willing to take responsibility for mistakes.")

    def test_merge_reference_continuations_trims_duplicate_prefix_with_translated_name(self):
        subtitles = [
            {
                "time": [40.08, 41.36],
                "zh": "但大家记住了：如果埃里克预测错了，",
                "en": "But everyone remembers: if Eric predicts wrong,",
                "text": "但大家记住了：如果埃里克预测错了，",
            },
            {
                "time": [41.36, 44.08],
                "zh": "埃里克预测错了，锅可是哥哥亲手递上的。",
                "en": "If Eric predicts wrong, the blame is handed over by his brother.",
                "text": "埃里克预测错了，锅可是哥哥亲手递上的。",
            },
        ]
        reference = [{
            "time": [33.64, 44.2],
            "zh": "所以，2026年的加密世界，一句玩笑比十份研报还具传播力。Don Jr没说涨跌，但大家记住了：如果Eric预测错了，锅可是哥哥亲手递上的",
        }]

        merged = run_asr.merge_reference_continuations(subtitles, reference)

        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[1]["zh"], "锅可是哥哥亲手递上的。")
        self.assertEqual(merged[1]["text"], "锅可是哥哥亲手递上的。")
        self.assertEqual(merged[1]["en"], "the blame is handed over by his brother.")

    def test_reference_alignment_retries_llm_when_protected_terms_are_translated(self):
        subtitles = [
            {
                "time": [0.16, 2.4],
                "zh": "At Consensus 2026",
                "en": "At Consensus 2026",
                "text": "At Consensus 2026",
            },
            {
                "time": [2.88, 4.4],
                "zh": "大会上，特朗普的儿子Don Jr",
                "en": "at the conference, Trump's son Don Jr",
                "text": "大会上，特朗普的儿子Don Jr",
            },
        ]
        reference = [
            {
                "time": [0.0, 8.15],
                "zh": "在Consensus 2026大会上，特朗普的儿子Don Jr直接甩锅：加密货币价格预测？让Eric背锅",
            }
        ]

        responses = [
            json.dumps([
                {
                    "index": 0,
                    "time": [0.16, 2.4],
                    "zh": "在2026共识大会",
                    "en": "At Consensus 2026",
                },
                {
                    "index": 1,
                    "time": [2.88, 4.4],
                    "zh": "大会上，特朗普的儿子Don Jr",
                    "en": "at the conference, Trump's son Don Jr",
                },
            ], ensure_ascii=False),
            json.dumps([
                {
                    "index": 0,
                    "time": [0.16, 2.4],
                    "zh": "在Consensus 2026大会",
                    "en": "At Consensus 2026",
                }
            ], ensure_ascii=False),
        ]

        class FakeResponse:
            def __init__(self, text):
                self.text = text

        with patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", side_effect=[FakeResponse(text) for text in responses]) as generate_content, \
                patch("pipeline.run_asr.emit_stage"):
            aligned = run_asr.align_subtitles_with_reference(subtitles, reference)

        merged = run_asr.merge_reference_continuations(aligned, reference)

        self.assertEqual(generate_content.call_count, 2)
        self.assertEqual(merged[0]["zh"], "在Consensus 2026大会")
        self.assertEqual(merged[0]["text"], merged[0]["zh"])
        self.assertEqual(merged[1]["zh"], "特朗普的儿子Don Jr")
        self.assertEqual(merged[1]["text"], merged[1]["zh"])

    def test_reference_text_authority_uses_asr_sentence_timing_without_rewriting_numbers(self):
        subtitles = [
            {
                "time": [0.16, 3.36],
                "zh": "Trump publicly promised to support 50 million",
                "en": "Trump publicly promised to support 50 million",
                "text": "Trump publicly promised to support 50 million",
            },
            {
                "time": [3.44, 5.04],
                "zh": "crypto holders' self-custody rights,",
                "en": "crypto holders' self-custody rights,",
                "text": "crypto holders' self-custody rights,",
            },
            {
                "time": [5.44, 8.32],
                "zh": "ensure Bitcoin future is made in America.",
                "en": "ensure Bitcoin future is made in America.",
                "text": "ensure Bitcoin future is made in America.",
            },
            {
                "time": [8.64, 10.24],
                "zh": "He also made clear,",
                "en": "He also made clear,",
                "text": "He also made clear,",
            },
        ]
        reference = [
            {
                "time": [0.0, 15.03],
                "zh": (
                    "特朗普公开承诺：支持5000万加密持有者自我托管权，"
                    "确保比特币未来在美国制造而非海外。"
                    "他同时明确，不会让Elizabeth Warren干扰你的比特币，也永不批准央行数字货币"
                ),
            }
        ]

        llm_response = json.dumps([
            {"index": 0, "text": "特朗普公开承诺：支持5000万加密持有者自我托管权，"},
            {"index": 1, "text": "确保比特币未来在美国制造而非海外。"},
            {"index": 2, "text": "他同时明确，不会让Elizabeth Warren干扰你的比特币，"},
            {"index": 3, "text": "也永不批准央行数字货币"},
        ], ensure_ascii=False)

        class FakeResponse:
            text = llm_response

        with patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", return_value=FakeResponse()) as generate_content, \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 26},
                source_language="en"
            )
        combined_text = "".join(item["zh"] for item in authoritative)

        generate_content.assert_called_once()
        self.assertGreaterEqual(len(authoritative), 2)
        self.assertEqual(authoritative[0]["time"][0], 0.16)
        self.assertIn("5000万", combined_text)
        self.assertIn("Elizabeth Warren", combined_text)
        self.assertIn("央行数字货币", combined_text)
        self.assertEqual(authoritative[-1]["zh"], "也永不批准央行数字货币")
        self.assertNotIn("50 million00万", combined_text)
        self.assertNotIn("50 million", combined_text)
        self.assertTrue(all(item["text"] == item["zh"] for item in authoritative))

    def test_reference_text_authority_accepts_validated_semantic_llm_groups(self):
        subtitles = [
            {"time": [21.7, 25.58], "zh": "他还提到，法案通过那天会被记住为华尔街正式", "text": "他还提到，法案通过那天会被记住为华尔街正式"},
            {"time": [25.58, 28.96], "zh": "入场。现在比特币已在8万美元", "text": "入场。现在比特币已在8万美元"},
            {"time": [29.04, 30.96], "zh": "上方，年底看到15万", "text": "上方，年底看到15万"},
            {"time": [31.36, 33.28], "zh": "并不是夸张，因为合规资金涌入才刚刚开始。", "text": "并不是夸张，因为合规资金涌入才刚刚开始。"},
            {"time": [33.76, 35.33], "zh": "这个飞轮效应一旦启动，后劲会非常大", "text": "这个飞轮效应一旦启动，后劲会非常大"},
        ]
        reference = [
            {
                "time": [21.7, 35.33],
                "zh": (
                    "他还提到，法案通过那天会被记住为华尔街正式入场。"
                    "现在比特币已在8万美元上方，年底看到15万并不是夸张，"
                    "因为合规资金涌入才刚刚开始。这个飞轮效应一旦启动，后劲会非常大"
                ),
            }
        ]

        llm_response = json.dumps([
            {"start_index": 0, "end_index": 1, "text": "他还提到，法案通过那天会被记住为华尔街正式入场。"},
            {"start_index": 1, "end_index": 2, "text": "现在比特币已在8万美元上方，年底看到15万"},
            {"start_index": 3, "end_index": 3, "text": "并不是夸张，因为合规资金涌入才刚刚开始。"},
            {"start_index": 4, "end_index": 4, "text": "这个飞轮效应一旦启动，后劲会非常大"},
        ], ensure_ascii=False)

        class FakeResponse:
            text = llm_response

        with patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", return_value=FakeResponse()), \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 30},
                source_language="zh",
            )

        texts = [item["zh"] for item in authoritative]
        self.assertGreaterEqual(len(authoritative), 4)
        self.assertIn("他还提到，法案通过那天会被记住为华尔街正式入场。", "".join(texts[:2]))
        self.assertIn("现在比特币已在8万美元上方，年底看到15万", "".join(texts))
        self.assertEqual(authoritative[0]["time"][0], 21.7)
        self.assertTrue(all(
            next_item["time"][0] >= item["time"][0]
            for item, next_item in zip(authoritative, authoritative[1:])
        ))
        self.assertEqual("".join(texts), reference[0]["zh"])

    def test_reference_text_authority_rejects_grouped_llm_rewrites(self):
        subtitles = [
            {"time": [0.0, 1.5], "zh": "support 50 million", "text": "support 50 million"},
            {"time": [1.5, 3.0], "zh": "self custody", "text": "self custody"},
        ]
        reference = [
            {"time": [0.0, 3.0], "zh": "支持5000万加密持有者自我托管权，确保比特币未来在美国制造"}
        ]

        class FakeResponse:
            text = json.dumps([
                {"start_index": 0, "end_index": 1, "text": "支持50 million00万加密持有者 self custody"},
            ], ensure_ascii=False)

        with patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", return_value=FakeResponse()), \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 30},
                source_language="en"
            )

        combined_text = "".join(item["zh"] for item in authoritative)
        self.assertIn("5000万", combined_text)
        self.assertNotIn("50 million00万", combined_text)
        self.assertNotIn("self custody", combined_text)

    def test_reference_text_authority_rejects_llm_rewrites(self):
        subtitles = [
            {"time": [0.0, 1.5], "zh": "support 50 million", "text": "support 50 million"},
            {"time": [1.5, 3.0], "zh": "self custody", "text": "self custody"},
        ]
        reference = [
            {"time": [0.0, 3.0], "zh": "支持5000万加密持有者自我托管权，确保比特币未来在美国制造"}
        ]

        class FakeResponse:
            text = json.dumps([
                {"index": 0, "text": "支持50 million00万"},
                {"index": 1, "text": "self custody"},
            ], ensure_ascii=False)

        with patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", return_value=FakeResponse()), \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 26},
                source_language="en"
            )

        combined_text = "".join(item["zh"] for item in authoritative)
        self.assertIn("5000万", combined_text)
        self.assertNotIn("50 million00万", combined_text)
        self.assertNotIn("self custody", combined_text)

    def test_reference_text_authority_allows_llm_readable_grouping(self):
        subtitles = [
            {"time": [21.7, 25.58], "zh": "他还提到法案通过那天", "text": "他还提到法案通过那天"},
            {"time": [25.58, 28.96], "zh": "会被记住为华尔街正式入场", "text": "会被记住为华尔街正式入场"},
            {"time": [29.04, 30.96], "zh": "现在比特币已在8万美元上方", "text": "现在比特币已在8万美元上方"},
            {"time": [31.36, 33.28], "zh": "年底看到15万并不是夸张", "text": "年底看到15万并不是夸张"},
        ]
        reference = [
            {
                "time": [21.7, 33.28],
                "zh": "他还提到，法案通过那天会被记住为华尔街正式入场。现在比特币已在8万美元上方，年底看到15万并不是夸张",
            }
        ]

        class FakeResponse:
            text = json.dumps([
                {
                    "start_index": 0,
                    "end_index": 1,
                    "text": "他还提到，法案通过那天会被记住为华尔街正式入场。",
                },
                {
                    "start_index": 2,
                    "end_index": 3,
                    "text": "现在比特币已在8万美元上方，年底看到15万并不是夸张",
                },
            ], ensure_ascii=False)

        with patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", return_value=FakeResponse()), \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 26},
                source_language="zh",
            )

        self.assertEqual(
            [item["zh"] for item in authoritative],
            [
                "他还提到，法案通过那天会被记住为华尔街正式入场。",
                "现在比特币已在8万美元上方，年底看到15万并不是夸张",
            ],
        )
        self.assertEqual(authoritative[0]["time"][0], 21.7)
        self.assertLessEqual(authoritative[0]["time"][1], 28.96)
        self.assertEqual(authoritative[1]["time"], [28.96, 33.28])

    def test_reference_text_authority_accepts_atom_grouping_without_model_copying_text(self):
        subtitles = [
            {"time": [21.7, 25.58], "zh": "他还提到，法案通过那天会被记住为华尔街正式", "text": "他还提到，法案通过那天会被记住为华尔街正式"},
            {"time": [25.58, 28.96], "zh": "入场。现在比特币已在8万美元", "text": "入场。现在比特币已在8万美元"},
            {"time": [29.04, 30.96], "zh": "上方，年底看到15万", "text": "上方，年底看到15万"},
            {"time": [31.36, 33.28], "zh": "并不是夸张，因为合规资金涌入才刚刚开始。", "text": "并不是夸张，因为合规资金涌入才刚刚开始。"},
            {"time": [33.76, 35.33], "zh": "这个飞轮效应一旦启动，后劲会非常大", "text": "这个飞轮效应一旦启动，后劲会非常大"},
        ]
        reference = [
            {
                "time": [21.7, 35.33],
                "zh": (
                    "他还提到，法案通过那天会被记住为华尔街正式入场。"
                    "现在比特币已在8万美元上方，年底看到15万并不是夸张，"
                    "因为合规资金涌入才刚刚开始。这个飞轮效应一旦启动，后劲会非常大"
                ),
            }
        ]

        class FakeResponse:
            text = json.dumps([
                {"start_atom_index": 0, "end_atom_index": 0},
                {"start_atom_index": 1, "end_atom_index": 2},
                {"start_atom_index": 3, "end_atom_index": 3},
                {"start_atom_index": 4, "end_atom_index": 4},
            ], ensure_ascii=False)

        with patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", return_value=FakeResponse()), \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 30},
                source_language="zh",
            )

        texts = [item["zh"] for item in authoritative]
        self.assertIn("他还提到，法案通过那天会被记住为华尔街正式入场。", "".join(texts[:2]))
        self.assertIn("现在比特币已在8万美元上方，年底看到15万", "".join(texts))
        self.assertEqual("".join(texts), reference[0]["zh"])
        self.assertEqual(authoritative[0]["time"][0], 21.7)
        self.assertLessEqual(authoritative[0]["time"][1], authoritative[1]["time"][0])

    def test_reference_text_authority_rejects_semantic_groups_that_shift_asr_owned_text(self):
        subtitles = [
            {"time": [21.7, 25.58], "zh": "他还提到，法案通过那天会被记住为华尔街正式", "text": "他还提到，法案通过那天会被记住为华尔街正式"},
            {"time": [25.58, 28.96], "zh": "入场。现在比特币已在8万美元", "text": "入场。现在比特币已在8万美元"},
            {"time": [29.04, 30.96], "zh": "上方，年底看到15万", "text": "上方，年底看到15万"},
        ]
        reference = [
            {
                "time": [21.7, 30.96],
                "zh": "他还提到，法案通过那天会被记住为华尔街正式入场。现在比特币已在8万美元上方，年底看到15万",
            }
        ]

        class FakeResponse:
            text = json.dumps([
                {
                    "start_index": 0,
                    "end_index": 0,
                    "text": "他还提到，法案通过那天会被记住为华尔街正式入场。现在比特币已在8万美元"
                },
                {
                    "start_index": 1,
                    "end_index": 2,
                    "text": "上方，年底看到15万"
                },
            ], ensure_ascii=False)

        with patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", return_value=FakeResponse()), \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 30},
                source_language="zh",
            )

        self.assertNotEqual(authoritative[0]["zh"], "他还提到，法案通过那天会被记住为华尔街正式入场。现在比特币已在8万美元")
        self.assertEqual(authoritative[1]["time"][0], 25.58)

    def test_reference_text_authority_rejects_semantic_groups_with_unreadable_duration(self):
        subtitles = [
            {"time": [20.24, 21.7], "zh": "这么大笔资金涌入，必然推高比特币价格", "text": "这么大笔资金涌入，必然推高比特币价格"},
            {"time": [21.7, 26.48], "zh": "他还提到，法案通过那天会被记住为华尔街正式入场。", "text": "他还提到，法案通过那天会被记住为华尔街正式入场。"},
        ]
        reference = [
            {
                "time": [20.24, 26.48],
                "zh": "这么大笔资金涌入，必然推高比特币价格他还提到，法案通过那天会被记住为华尔街正式入场。",
            }
        ]

        class FakeResponse:
            text = json.dumps([
                {"start_atom_index": 0, "end_atom_index": 0},
                {"start_atom_index": 1, "end_atom_index": 1},
            ], ensure_ascii=False)

        with patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", return_value=FakeResponse()), \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 30},
                source_language="zh",
            )

        first = authoritative[0]
        self.assertEqual(first["zh"], "这么大笔资金涌入，必然推高比特币价格")
        self.assertEqual(first["time"][1], 21.7)
        self.assertGreaterEqual(first["time"][1] - first["time"][0], 1.45)

    def test_reference_text_authority_rejects_index_assignment_with_unreadable_duration(self):
        subtitles = [
            {"time": [25.79, 26.16], "zh": "他接着补充", "text": "他接着补充"},
            {"time": [26.16, 30.32], "zh": "早期参与比特币的人会创造巨大的潜在市场", "text": "早期参与比特币的人会创造巨大的潜在市场"},
            {"time": [30.32, 36.93], "zh": "这番表态等于承认比特币的抗通胀属性和网络效应来自美联储前主席之口分量不轻", "text": "这番表态等于承认比特币的抗通胀属性和网络效应来自美联储前主席之口分量不轻"},
        ]
        reference = [
            {
                "time": [25.79, 36.93],
                "zh": "他接着补充，早期参与比特币的人，会创造巨大的潜在市场。这番表态等于承认比特币的抗通胀属性和网络效应，来自美联储前主席之口，分量不轻",
            }
        ]

        class FakeResponse:
            text = json.dumps([
                {"index": 0, "text": "他接着补充，早期参与比特币的人，会创造巨大的潜在市场。"},
                {"index": 1, "text": "这番表态等于承认比特币的抗通胀属性和网络效应，"},
                {"index": 2, "text": "来自美联储前主席之口，分量不轻"},
            ], ensure_ascii=False)

        with patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", return_value=FakeResponse()), \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 30},
                source_language="zh",
            )

        first_sentence = next(item for item in authoritative if item["zh"].startswith("他接着补充"))
        self.assertEqual(first_sentence["time"], [25.79, 30.32])
        self.assertFalse(any(run_asr.has_unreadable_subtitle_duration(item) for item in authoritative))
        self.assertEqual("".join(item["zh"] for item in authoritative), reference[0]["zh"])

    def test_reference_text_authority_quality_gate_falls_back_after_bad_llm_grouping(self):
        subtitles = [
            {"time": [25.79, 26.16], "zh": "他接着补充", "text": "他接着补充"},
            {"time": [26.16, 30.32], "zh": "早期参与比特币的人会创造巨大的潜在市场", "text": "早期参与比特币的人会创造巨大的潜在市场"},
            {"time": [30.32, 36.93], "zh": "这番表态等于承认比特币的抗通胀属性和网络效应来自美联储前主席之口分量不轻", "text": "这番表态等于承认比特币的抗通胀属性和网络效应来自美联储前主席之口分量不轻"},
        ]
        reference = [
            {
                "time": [25.79, 36.93],
                "zh": "他接着补充，早期参与比特币的人，会创造巨大的潜在市场。这番表态等于承认比特币的抗通胀属性和网络效应，来自美联储前主席之口，分量不轻",
            }
        ]

        with patch("pipeline.run_asr.align_reference_authority_with_llm", return_value=[
            {
                "time": [25.79, 26.16],
                "zh": "他接着补充，早期参与比特币的人，会创造巨大的潜在市场。",
                "text": "他接着补充，早期参与比特币的人，会创造巨大的潜在市场。",
            },
            {
                "time": [26.16, 30.32],
                "zh": "这番表态等于承认比特币的抗通胀属性和网络效应，",
                "text": "这番表态等于承认比特币的抗通胀属性和网络效应，",
            },
            {
                "time": [30.32, 36.93],
                "zh": "来自美联储前主席之口，分量不轻",
                "text": "来自美联储前主席之口，分量不轻",
            },
        ]):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 30},
                source_language="zh",
                use_llm=True,
            )

        first_sentence = next(item for item in authoritative if item["zh"].startswith("他接着补充"))
        self.assertEqual(first_sentence["time"], [25.79, 30.32])
        self.assertFalse(run_asr.subtitle_timing_quality_issues(authoritative, include_overextended=True))

    def test_strict_reference_text_authority_retries_until_validated_grouping(self):
        subtitles = [
            {"time": [17.92, 20.32], "zh": "这意味着比特币正被认真", "text": "这意味着比特币正被认真"},
            {"time": [20.32, 23.42], "zh": "考虑作为国家层面的价值储存工具", "text": "考虑作为国家层面的价值储存工具"},
        ]
        reference = [
            {
                "time": [17.92, 23.42],
                "zh": "这意味着比特币正被认真考虑作为国家层面的价值储存工具",
            }
        ]

        invalid_response = json.dumps([
                {"start_index": 0, "end_index": 0, "text": "这意味着比特币正被认真"},
                {"start_index": 1, "end_index": 1, "text": "考虑作为国家层面的价值储存工具"},
        ], ensure_ascii=False)

        class FakeResponse:
            def __init__(self, text):
                self.text = text

        attempts = []

        def fake_generate_content(*_args, **kwargs):
            attempts.append(kwargs["contents"])
            if len(attempts) == 1:
                return FakeResponse(invalid_response)
            payload = json.loads(kwargs["contents"].split("输入：", 1)[1])
            atoms = payload.get("reference_atoms") or []
            allowed = {
                (item["start_atom_index"], item["end_atom_index"])
                for item in payload.get("allowed_atom_ranges") or []
            }
            full_range = (0, len(atoms) - 1)
            self.assertIn(full_range, allowed)
            return FakeResponse(json.dumps([
                {"start_atom_index": full_range[0], "end_atom_index": full_range[1]},
            ], ensure_ascii=False))

        with patch.dict(os.environ, {"REFERENCE_AUTHORITY_LLM_RETRIES": "2"}), \
                patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", side_effect=fake_generate_content) as generate_content, \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 30},
                source_language="zh",
                strict=True,
            )

        self.assertEqual(generate_content.call_count, 2)
        self.assertEqual([item["zh"] for item in authoritative], [
            "这意味着比特币正被认真考虑作为国家层面的价值储存工具",
        ])
        self.assertEqual("".join(item["zh"] for item in authoritative), reference[0]["zh"])

    def test_strict_reference_text_authority_removes_orphan_asr_fragment_before_llm(self):
        subtitles = [
            {"time": [13.0, 13.56], "zh": "产。", "text": "产。"},
            {"time": [13.56, 17.28], "zh": "他预计政府初期可能只配置储备的1%，", "text": "他预计政府初期可能只配置储备的1%，"},
            {"time": [17.28, 19.84], "zh": "但长期看比例会逐步上升。", "text": "但长期看比例会逐步上升。"},
            {"time": [19.84, 23.42], "zh": "这意味着比特币正被认真考虑作为国家层面的价值储存工具", "text": "这意味着比特币正被认真考虑作为国家层面的价值储存工具"},
        ]
        reference = [
            {
                "time": [13.3, 23.42],
                "zh": "他预计政府初期可能只配置储备的1%，但长期看比例会逐步上升。这意味着比特币正被认真考虑作为国家层面的价值储存工具",
            }
        ]
        captured_payloads = []

        class FakeResponse:
            def __init__(self, text):
                self.text = text

        def fake_generate_content(*_args, **kwargs):
            prompt = kwargs["contents"]
            payload = json.loads(prompt.split("输入：", 1)[1])
            captured_payloads.append(payload)
            asr_texts = [item["asr_text"] for item in payload["asr_segments"]]
            self.assertNotIn("产。", asr_texts)
            atoms = payload.get("reference_atoms") or []
            self.assertTrue(atoms)
            allowed = {
                (item["start_atom_index"], item["end_atom_index"])
                for item in payload.get("allowed_atom_ranges") or []
            }
            choices = []
            index = 0
            while index < len(atoms):
                candidates = sorted(
                    [item for item in allowed if item[0] == index],
                    key=lambda item: (item[1] - item[0], item[1]),
                    reverse=True,
                )
                self.assertTrue(candidates)
                start_atom_index, end_atom_index = candidates[0]
                choices.append({
                    "start_atom_index": start_atom_index,
                    "end_atom_index": end_atom_index,
                })
                index = end_atom_index + 1
            return FakeResponse(json.dumps([
                item for item in choices
            ], ensure_ascii=False))

        with patch.dict(os.environ, {"REFERENCE_AUTHORITY_LLM_RETRIES": "1"}), \
                patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", side_effect=fake_generate_content), \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 30},
                source_language="zh",
                strict=True,
            )

        self.assertTrue(captured_payloads)
        self.assertEqual(
            captured_payloads[0]["asr_segments"][0]["asr_text"],
            "他预计政府初期可能只配置储备的1%，",
        )
        self.assertNotIn("产。", "".join(item["zh"] for item in authoritative))
        self.assertEqual("".join(item["zh"] for item in authoritative), reference[0]["zh"])

    def test_strict_reference_text_authority_splits_long_mixed_language_atoms_for_llm(self):
        subtitles = [
            {"time": [0.0, 1.6], "zh": "B M R Boost", "text": "B M R Boost"},
            {"time": [1.6, 3.6], "zh": "账号分享Tom Lee", "text": "账号分享Tom Lee"},
            {"time": [3.68, 4.72], "zh": "最新判断，", "text": "最新判断，"},
            {"time": [5.12, 8.0], "zh": "关于下季回调15减他称这", "text": "关于下季回调15减他称这"},
            {"time": [8.0, 8.64], "zh": "是我们lives", "text": "是我们lives"},
            {"time": [8.8, 10.56], "zh": "中最大的反弹，第一", "text": "中最大的反弹，第一"},
            {"time": [10.56, 12.4], "zh": "big trail ray of our lifetime，", "text": "big trail ray of our lifetime，"},
            {"time": [12.64, 14.24], "zh": "钱的痛苦，先经历", "text": "钱的痛苦，先经历"},
            {"time": [14.24, 15.04], "zh": "pain再迎来", "text": "pain再迎来"},
            {"time": [15.04, 16.0], "zh": "generational rally。", "text": "generational rally。"},
            {"time": [16.4, 17.6], "zh": "他点名B M A", "text": "他点名B M A"},
            {"time": [17.6, 18.72], "zh": "和E T F，", "text": "和E T F，"},
        ]
        reference = [
            {
                "time": [0.0, 18.76],
                "zh": (
                    "BMNRBullz账号分享Tom Lee最新判断：关于夏季回调15-20%，"
                    "他称这是“我们lives中最大的反弹”（THE BIGGEST RALLY OF OUR LIFETIME）前的痛苦。"
                    "先经历Pain，再迎来Generational rally。他点名$BMNR和$ETH"
                ),
            }
        ]
        captured_payloads = []

        class FakeResponse:
            def __init__(self, text):
                self.text = text

        def fake_generate_content(*_args, **kwargs):
            payload = json.loads(kwargs["contents"].split("输入：", 1)[1])
            captured_payloads.append(payload)
            atoms = payload.get("reference_atoms") or []
            self.assertTrue(atoms)
            self.assertTrue(all(run_asr.readable_visible_len(atom["text"]) <= 24 for atom in atoms))
            self.assertTrue(any("BIGGEST RALLY OF OUR" in atom["text"] for atom in atoms))
            allowed = {
                (item["start_atom_index"], item["end_atom_index"])
                for item in payload.get("allowed_atom_ranges") or []
            }
            choices = []
            index = 0
            while index < len(atoms):
                pair = (index, index + 1)
                if index + 1 < len(atoms) and pair in allowed:
                    choices.append({"start_atom_index": pair[0], "end_atom_index": pair[1]})
                    index += 2
                else:
                    choices.append({"start_atom_index": index, "end_atom_index": index})
                    index += 1
            return FakeResponse(json.dumps(choices, ensure_ascii=False))

        with patch.dict(os.environ, {"REFERENCE_AUTHORITY_LLM_RETRIES": "1"}), \
                patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", side_effect=fake_generate_content), \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 30},
                source_language="zh",
                strict=True,
            )

        self.assertTrue(captured_payloads)
        self.assertEqual("".join(item["zh"] for item in authoritative), reference[0]["zh"])
        self.assertFalse(run_asr.severe_subtitle_timing_quality_issues(authoritative))

    def test_strict_reference_text_authority_removes_repeated_previous_tail_at_block_start(self):
        subtitles = [
            {"time": [18.8, 19.36], "zh": "基础设施。", "text": "基础设施。"},
            {"time": [19.76, 22.64], "zh": "更关键的是，全球前五的支付商中有一家", "text": "更关键的是，全球前五的支付商中有一家"},
            {"time": [22.64, 24.64], "zh": "决定把整个支付系统迁移到区块链。", "text": "决定把整个支付系统迁移到区块链。"},
            {"time": [24.96, 27.84], "zh": "加密基础设施现在能一秒钟把一分钱转到", "text": "加密基础设施现在能一秒钟把一分钱转到"},
            {"time": [27.84, 28.64], "zh": "世界任何角落。", "text": "世界任何角落。"},
        ]
        reference = [
            {
                "time": [18.37, 27.8],
                "zh": "更关键的是，全球前五的支付商中有一家决定把整个支付系统迁移到区块链。加密基础设施现在能一秒钟把一分钱转到世界任何角落",
            }
        ]
        captured_payloads = []

        class FakeResponse:
            def __init__(self, text):
                self.text = text

        def fake_generate_content(*_args, **kwargs):
            payload = json.loads(kwargs["contents"].split("输入：", 1)[1])
            captured_payloads.append(payload)
            asr_texts = [item["asr_text"] for item in payload["asr_segments"]]
            self.assertNotEqual(asr_texts[0], "基础设施。")
            atoms = payload.get("reference_atoms") or []
            self.assertTrue(atoms)
            self.assertTrue(all(run_asr.readable_visible_len(atom["text"]) <= 24 for atom in atoms))
            allowed = {
                (item["start_atom_index"], item["end_atom_index"])
                for item in payload.get("allowed_atom_ranges") or []
            }
            self.assertIn((0, 1), allowed)
            self.assertIn((2, 3), allowed)
            return FakeResponse(json.dumps([
                {"start_atom_index": 0, "end_atom_index": 1},
                {"start_atom_index": 2, "end_atom_index": 3},
            ], ensure_ascii=False))

        with patch.dict(os.environ, {"REFERENCE_AUTHORITY_LLM_RETRIES": "1"}), \
                patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", side_effect=fake_generate_content), \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 26},
                source_language="zh",
                strict=True,
            )

        self.assertTrue(captured_payloads)
        self.assertEqual("".join(item["zh"] for item in authoritative), reference[0]["zh"])
        self.assertEqual(authoritative[0]["time"][0], 19.76)
        self.assertFalse(run_asr.severe_subtitle_timing_quality_issues(authoritative))

    def test_reference_authority_atom_ranges_allow_tail_fragment_with_previous_sentence(self):
        subtitles = [
            {"time": [22.4, 25.28], "zh": "特币资产独特，政府需要以不同方式操", "text": "特币资产独特，政府需要以不同方式操"},
            {"time": [25.28, 25.44], "zh": "作。", "text": "作。"},
            {"time": [25.84, 26.48], "zh": "Harry John", "text": "Harry John"},
            {"time": [26.48, 28.16], "zh": "带领团队推动跨部门流程，", "text": "带领团队推动跨部门流程，"},
            {"time": [28.64, 29.76], "zh": "确保执行令落实。", "text": "确保执行令落实。"},
            {"time": [30.24, 33.04], "zh": "公告一出，储备从政策文件走向实际", "text": "公告一出，储备从政策文件走向实际"},
            {"time": [33.04, 33.28], "zh": "执行。", "text": "执行。"},
        ]
        reference = [
            {
                "time": [22.4, 33.28],
                "zh": "比特币资产独特，政府需要以不同方式操作。Harry Jung 带领团队推动跨部门流程，确保执行令落实。公告一出，储备从政策文件走向实际执行",
            }
        ]

        prompt = run_asr.build_reference_authority_prompt(
            subtitles,
            reference[0]["zh"],
            source_language="zh",
            split_config={"max_chunk_duration": 4.2, "max_visible_chars": 26},
        )
        payload = json.loads(prompt.split("输入：", 1)[1])
        atoms = payload["reference_atoms"]
        allowed = {
            (item["start_atom_index"], item["end_atom_index"])
            for item in payload["allowed_atom_ranges"]
        }
        self.assertEqual(atoms[0]["text"], "比特币资产独特，政府需要以不同方式操作。")
        self.assertEqual(atoms[0]["time"], [22.4, 25.44])
        self.assertEqual(atoms[1]["time"][0], 25.84)
        self.assertIn((1, 2), allowed)
        validated = run_asr.validate_reference_authority_llm_results(
            subtitles,
            reference[0]["zh"],
            [
                {"start_atom_index": 0, "end_atom_index": 0},
                {"start_atom_index": 1, "end_atom_index": 2},
                {"start_atom_index": 3, "end_atom_index": 3},
            ],
            {"max_chunk_duration": 4.2, "max_visible_chars": 26},
            require_atom_groups=True,
        )
        self.assertEqual("".join(item["zh"] for item in validated), reference[0]["zh"])
        self.assertFalse(run_asr.severe_subtitle_timing_quality_issues(validated))

    def test_strict_reference_text_authority_assigns_boundary_prefix_to_next_block(self):
        subtitles = [
            {"time": [0.0, 0.64], "zh": "Michael Saylor", "text": "Michael Saylor"},
            {"time": [0.72, 3.6], "zh": "说，他要给亿人提供年化8%", "text": "说，他要给亿人提供年化8%"},
            {"time": [3.84, 5.52], "zh": "收益、零波动的银行账户。", "text": "收益、零波动的银行账户。"},
            {"time": [5.76, 7.2], "zh": "这听起来像天方夜谭，", "text": "这听起来像天方夜谭，"},
            {"time": [7.44, 8.16], "zh": "但MicroStrategy", "text": "但MicroStrategy"},
            {"time": [8.48, 10.96], "zh": "的掌舵人正在把这个愿景推到台前。", "text": "的掌舵人正在把这个愿景推到台前。"},
            {"time": [11.2, 11.76], "zh": "Saylor", "text": "Saylor"},
            {"time": [12.0, 13.4], "zh": "坦承这很难，", "text": "坦承这很难，"},
            {"time": [13.4, 16.2], "zh": "就像建核反应堆换取免费电力。", "text": "就像建核反应堆换取免费电力。"},
            {"time": [16.2, 18.8], "zh": "他的思路是，用比特币作储备，", "text": "他的思路是，用比特币作储备，"},
            {"time": [18.8, 21.7], "zh": "通过金融工程把波动对冲掉，输出一个接近无风险的收益", "text": "通过金融工程把波动对冲掉，输出一个接近无风险的收益"},
        ]
        reference = [
            {
                "time": [0, 11.98],
                "zh": "Michael Saylor 说，他要给十亿人提供年化8%收益、零波动的银行账户。这听起来像天方夜谭，但 MicroStrategy 的掌舵人正在把这个愿景推到台前",
            },
            {
                "time": [11.98, 21.7],
                "zh": "Saylor 坦承这很难，就像建核反应堆换取免费电力。他的思路是，用比特币作储备，通过金融工程把波动对冲掉，输出一个接近无风险的收益",
            },
        ]
        captured_payloads = []

        class FakeResponse:
            def __init__(self, text):
                self.text = text

        def choose_allowed_partition(atom_count, allowed_ranges):
            by_start = {}
            for start, end in allowed_ranges:
                by_start.setdefault(start, []).append(end)
            memo = {}

            def visit(start):
                if start == atom_count:
                    return []
                if start in memo:
                    return memo[start]
                for end in sorted(by_start.get(start, []), reverse=True):
                    tail = visit(end + 1)
                    if tail is not None:
                        memo[start] = [(start, end)] + tail
                        return memo[start]
                memo[start] = None
                return None

            return visit(0)

        def fake_generate_content(*_args, **kwargs):
            payload = json.loads(kwargs["contents"].split("输入：", 1)[1])
            captured_payloads.append(payload)
            atoms = payload.get("reference_atoms") or []
            allowed_ranges = {
                (item["start_atom_index"], item["end_atom_index"])
                for item in payload.get("allowed_atom_ranges") or []
            }
            choices = choose_allowed_partition(len(atoms), allowed_ranges)
            self.assertIsNotNone(choices)
            return FakeResponse(json.dumps([
                {"start_atom_index": start, "end_atom_index": end}
                for start, end in choices
            ], ensure_ascii=False))

        with patch.dict(os.environ, {"REFERENCE_AUTHORITY_LLM_RETRIES": "1"}), \
                patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", side_effect=fake_generate_content), \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 26},
                source_language="zh",
                strict=True,
            )

        self.assertEqual(len(captured_payloads), 2)
        self.assertNotEqual(captured_payloads[0]["asr_segments"][-1]["asr_text"], "Saylor")
        self.assertEqual(captured_payloads[1]["asr_segments"][0]["asr_text"], "Saylor")
        self.assertEqual(
            run_asr.visible_text("".join(item["zh"] for item in authoritative)),
            run_asr.visible_text("".join(item["zh"] for item in reference)),
        )
        self.assertFalse(run_asr.severe_subtitle_timing_quality_issues(authoritative))

    def test_reference_authority_boundary_prefix_rule_is_not_keyword_specific(self):
        asr_entries = [
            {"time": [0.0, 1.2], "zh": "第一段介绍背景", "text": "第一段介绍背景"},
            {"time": [1.2, 2.4], "zh": "并说明核心原因。", "text": "并说明核心原因。"},
            {"time": [2.64, 3.0], "zh": "第二点", "text": "第二点"},
            {"time": [3.12, 4.4], "zh": "才是关键结论。", "text": "才是关键结论。"},
        ]
        reference = [
            {"time": [0.0, 2.8], "zh": "第一段介绍背景，并说明核心原因。"},
            {"time": [2.8, 4.4], "zh": "第二点才是关键结论。"},
        ]

        first = run_asr.collect_asr_entries_for_reference(asr_entries, reference[0], set(), reference[1])
        used = {index for index, _entry in first}
        second = run_asr.collect_asr_entries_for_reference(asr_entries, reference[1], used)

        self.assertEqual([entry["zh"] for _index, entry in first], [
            "第一段介绍背景",
            "并说明核心原因。",
        ])
        self.assertEqual([entry["zh"] for _index, entry in second], [
            "第二点",
            "才是关键结论。",
        ])

    def test_strict_reference_text_authority_closes_continuous_block_gaps(self):
        subtitles = [
            {"time": [0.0, 4.0], "zh": "黄仁勋说，如果两个应届生候选人，一个精通 AI，", "text": "黄仁勋说，如果两个应届生候选人，一个精通 AI，"},
            {"time": [4.0, 7.2], "zh": "一个完全不懂，他会毫不犹豫选那个 AI 专家。", "text": "一个完全不懂，他会毫不犹豫选那个 AI 专家。"},
            {"time": [7.2, 11.3], "zh": "而且这条标准，不只看技术岗，财务、营销、客服、销售，全都一样", "text": "而且这条标准，不只看技术岗，财务、营销、客服、销售，全都一样"},
            {"time": [12.96, 18.88], "zh": "他进一步建议，如果当前工作包含重复性任务，就应该去学用 AI 自动化它。", "text": "他进一步建议，如果当前工作包含重复性任务，就应该去学用 AI 自动化它。"},
            {"time": [18.88, 22.24], "zh": "他还举了个例子：你可以直接问 AI 怎样提升我的工作技能，", "text": "他还举了个例子：你可以直接问 AI 怎样提升我的工作技能，"},
            {"time": [22.24, 24.03], "zh": "它会给你一份详细的步骤计划", "text": "它会给你一份详细的步骤计划"},
            {"time": [26.96, 28.56], "zh": "未来十年，AI 很可能像当年 Excel 一样，", "text": "未来十年，AI 很可能像当年 Excel 一样，"},
            {"time": [28.56, 30.64], "zh": "成为职场基础技能。", "text": "成为职场基础技能。"},
        ]
        reference = [
            {
                "time": [0.0, 11.3],
                "zh": "黄仁勋说，如果两个应届生候选人，一个精通AI，一个完全不懂，他会毫不犹豫选那个AI专家。而且这条标准，不只看技术岗，财务、营销、客服、销售，全都一样",
            },
            {
                "time": [11.3, 24.03],
                "zh": "他进一步建议，如果当前工作包含重复性任务，就应该去学用AI自动化它。他还举了个例子：你可以直接问AI“怎样提升我的工作技能”，它会给你一份详细的步骤计划",
            },
            {
                "time": [24.03, 30.64],
                "zh": "未来十年，AI很可能像当年Excel一样，成为职场基础技能。",
            },
        ]

        def fake_generate_content(*_args, **kwargs):
            payload = json.loads(kwargs["contents"].split("输入：", 1)[1])
            atoms = payload.get("reference_atoms") or []
            if not atoms:
                asr_segments = payload.get("asr_segments") or []
                pieces = run_asr.split_reference_text_by_asr_segments(payload.get("reference_text") or "", asr_segments)

                class FallbackResponse:
                    text = json.dumps([
                        {"index": index, "text": piece}
                        for index, piece in enumerate(pieces)
                    ], ensure_ascii=False)

                return FallbackResponse()

            allowed = {
                (item["start_atom_index"], item["end_atom_index"])
                for item in payload.get("allowed_atom_ranges") or []
            }
            choices = []
            index = 0
            while index < len(atoms):
                candidates = sorted(
                    [item for item in allowed if item[0] == index],
                    key=lambda item: (item[1] - item[0], item[1]),
                    reverse=True,
                )
                self.assertTrue(candidates)
                start_atom_index, end_atom_index = candidates[0]
                choices.append({
                    "start_atom_index": start_atom_index,
                    "end_atom_index": end_atom_index,
                })
                index = end_atom_index + 1

            class FakeResponse:
                text = json.dumps(choices, ensure_ascii=False)

            return FakeResponse()

        with patch.dict(os.environ, {"REFERENCE_AUTHORITY_LLM_RETRIES": "1"}), \
                patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", side_effect=fake_generate_content), \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 26},
                source_language="zh",
                strict=True,
            )

        self.assertEqual("".join(item["zh"] for item in authoritative), "".join(item["zh"] for item in reference))
        self.assertTrue(any(item["time"][0] == 11.3 for item in authoritative))
        self.assertTrue(any(item["time"][0] == 24.03 for item in authoritative))
        self.assertLessEqual(
            max(next_item["time"][0] - item["time"][1] for item, next_item in zip(authoritative, authoritative[1:])),
            0.03,
        )

    def test_reference_text_authority_keeps_numeric_equivalent_block_prefix(self):
        subtitles = [
            {"time": [24.72, 25.84], "zh": "未来10年，AI", "text": "未来10年，AI"},
            {"time": [26.16, 26.88], "zh": "可能像当年Excel", "text": "可能像当年Excel"},
            {"time": [26.96, 28.56], "zh": "一样，成为职场基础技能。", "text": "一样，成为职场基础技能。"},
            {"time": [28.88, 30.24], "zh": "黄仁勋的表达很直白，", "text": "黄仁勋的表达很直白，"},
        ]
        reference = {
            "time": [24.03, 37.12],
            "zh": "未来十年，AI很可能像当年Excel一样，成为职场基础技能。黄仁勋的表达很直白：不会用AI的求职者，竞争力会明显落后。",
        }

        selected = run_asr.collect_asr_entries_for_reference(subtitles, reference, set())

        self.assertTrue(selected)
        self.assertEqual(selected[0][1]["zh"], "未来10年，AI")

    def test_strict_reference_text_authority_accepts_character_position_groups(self):
        subtitles = [
            {"time": [24.8, 25.92], "zh": "未来10年，AI", "text": "未来10年，AI"},
            {"time": [25.92, 26.96], "zh": "可能像当年Excel", "text": "可能像当年Excel"},
            {"time": [26.96, 28.56], "zh": "一样，成为职场基础技能。", "text": "一样，成为职场基础技能。"},
            {"time": [28.88, 30.24], "zh": "黄仁勋的表达很直白，", "text": "黄仁勋的表达很直白，"},
            {"time": [30.64, 33.44], "zh": "不会用AI求职者竞争力会明显落后，", "text": "不会用AI求职者竞争力会明显落后，"},
            {"time": [33.84, 35.68], "zh": "趁早把AI工具练成习惯，", "text": "趁早把AI工具练成习惯，"},
            {"time": [35.92, 37.12], "zh": "是个人最值得做的事。", "text": "是个人最值得做的事。"},
        ]
        reference = [
            {
                "time": [24.03, 37.12],
                "zh": "未来十年，AI 很可能像当年 Excel 一样，成为职场基础技能。黄仁勋的表达很直白：不会用 AI 的求职者，竞争力会明显落后。趁早把 AI 工具练成习惯，是个人最值得做的事",
            }
        ]

        class FakeResponse:
            text = json.dumps([
                {"start_index": 0, "end_index": 24, "text": "未来十年，AI 很可能像当年 Excel 一样，"},
                {"start_index": 24, "end_index": 33, "text": "成为职场基础技能。"},
                {"start_index": 33, "end_index": 55, "text": "黄仁勋的表达很直白：不会用 AI 的求职者，"},
                {"start_index": 55, "end_index": 64, "text": "竞争力会明显落后。"},
                {"start_index": 64, "end_index": 87, "text": "趁早把 AI 工具练成习惯，是个人最值得做的事"},
            ], ensure_ascii=False)

        with patch.dict(os.environ, {"REFERENCE_AUTHORITY_LLM_RETRIES": "1"}), \
                patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", return_value=FakeResponse()), \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 26},
                source_language="zh",
                strict=True,
            )

        self.assertEqual("".join(item["zh"] for item in authoritative), reference[0]["zh"])
        self.assertLessEqual(
            max(next_item["time"][0] - item["time"][1] for item, next_item in zip(authoritative, authoritative[1:])),
            0.03,
        )

    def test_strict_reference_text_authority_replays_reference_authority_recur_again(self):
        subtitles = [
            {"time": [36.32, 39.2], "zh": "当然AI编程目前还难以搞定全新的架构", "text": "当然AI编程目前还难以搞定全新的架构"},
            {"time": [39.2, 41.36], "zh": "创新，更多是优化现有流程。", "text": "创新，更多是优化现有流程。"},
            {"time": [41.92, 43.36], "zh": "但一旦10倍加速落地，", "text": "但一旦10倍加速落地，"},
            {"time": [43.68, 46.64], "zh": "软件行业的交付节奏和团队协作方式都会被彻", "text": "软件行业的交付节奏和团队协作方式都会被彻"},
            {"time": [46.64, 47.2], "zh": "底重塑。", "text": "底重塑。"},
        ]
        reference = [
            {
                "time": [36.32, 47.2],
                "zh": "当然，AI 编程目前还难以搞定全新的架构创新，更多是优化现有流程。但一旦 10 倍加速落地，软件行业的交付节奏和团队协作方式都会被彻底重塑",
            }
        ]

        class FakeResponse:
            text = json.dumps([
                {"start_index": 0, "end_index": 19, "text": "当然，AI 编程目前还难以搞定全新的架构"},
                {"start_index": 20, "end_index": 32, "text": "创新，更多是优化现有流程。"},
                {"start_index": 33, "end_index": 45, "text": "但一旦 10 倍加速落地，"},
                {"start_index": 46, "end_index": 68, "text": "软件行业的交付节奏和团队协作方式都会被彻底重塑"},
            ], ensure_ascii=False)

        with patch.dict(os.environ, {"REFERENCE_AUTHORITY_LLM_RETRIES": "1"}), \
                patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", return_value=FakeResponse()), \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 26},
                source_language="zh",
                strict=True,
            )

        self.assertEqual("".join(item["zh"] for item in authoritative), reference[0]["zh"])
        self.assertFalse(run_asr.severe_subtitle_timing_quality_issues(authoritative))
        self.assertGreaterEqual(len(authoritative), 3)

    def test_strict_reference_text_authority_fails_soft_to_deterministic_split(self):
        subtitles = [
            {"time": [17.92, 20.32], "zh": "这意味着比特币正被认真", "text": "这意味着比特币正被认真"},
            {"time": [20.32, 23.42], "zh": "考虑作为国家层面的价值储存工具", "text": "考虑作为国家层面的价值储存工具"},
        ]
        reference = [
            {
                "time": [17.92, 23.42],
                "zh": "这意味着比特币正被认真考虑作为国家层面的价值储存工具",
            }
        ]

        class FakeResponse:
            text = json.dumps([
                {"start_index": 0, "end_index": 0, "text": "这意味着比特币正被认真"},
                {"start_index": 1, "end_index": 1, "text": "考虑作为国家层面的价值储存工具"},
            ], ensure_ascii=False)

        with patch.dict(os.environ, {"REFERENCE_AUTHORITY_LLM_RETRIES": "1"}), \
                patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", return_value=FakeResponse()), \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_visible_chars": 30},
                source_language="zh",
                strict=True,
            )

        self.assertEqual("".join(item["zh"] for item in authoritative), reference[0]["zh"])
        self.assertFalse(run_asr.severe_subtitle_timing_quality_issues(authoritative))

    def test_strict_reference_text_authority_replays_reference_authority_stable_success(self):
        subtitles = [
            {
                "time": [15.84, 17.44],
                "zh": "但这只是让人们接受的套路。",
                "text": "但这只是让人们接受的套路。",
            },
            {
                "time": [17.76, 20.72],
                "zh": "任何可停止、可审查的工具都与比特币",
                "text": "任何可停止、可审查的工具都与比特币",
            },
            {
                "time": [20.72, 22.24],
                "zh": "主权使命背道而驰。",
                "text": "主权使命背道而驰。",
            },
            {
                "time": [22.72, 25.92],
                "zh": "视频强调目标是让亿人都拥有金融主权。",
                "text": "视频强调目标是让亿人都拥有金融主权。",
            },
        ]
        reference = [
            {
                "time": [16.93, 27.47],
                "zh": "稳定币常被宣传为生命线，但这只是让人们接受的套路。任何可停止可审查的工具，都与比特币主权使命背道而驰。视频强调，目标是让八十亿人都拥有金融主权",
            }
        ]

        class FakeResponse:
            text = json.dumps([
                {"start_atom_index": 1, "end_atom_index": 1},
                {"start_atom_index": 2, "end_atom_index": 2},
            ], ensure_ascii=False)

        fallback_events = []

        with patch.dict(os.environ, {"REFERENCE_AUTHORITY_LLM_RETRIES": "1"}), \
                patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", return_value=FakeResponse()), \
                patch("pipeline.run_asr.append_reference_authority_debug_event", side_effect=fallback_events.append), \
                patch("pipeline.run_asr.emit_stage"):
            authoritative = run_asr.build_reference_authority_subtitles(
                subtitles,
                reference,
                {"max_chunk_duration": 4.2, "max_visible_chars": 26},
                source_language="zh",
                strict=True,
            )

        self.assertEqual("".join(item["zh"] for item in authoritative), reference[0]["zh"])
        self.assertFalse(run_asr.severe_subtitle_timing_quality_issues(authoritative))
        self.assertTrue(any(
            event.get("event_type") == "reference_authority_fallback"
            and event.get("fallback_stage") in {
                "deterministic_reference_authority_split",
                "reference_subtitle_timing",
            }
            for event in fallback_events
        ))

    def test_reference_text_authority_repairs_dangling_verb_object_breaks(self):
        subtitles = [
            {"time": [25.79, 27.95], "zh": "他接着补充，早期参与比特币的人，会创造", "text": "他接着补充，早期参与比特币的人，会创造"},
            {"time": [27.95, 33.12], "zh": "巨大的潜在市场。这番表态等于承认比特币的抗通胀属性和", "text": "巨大的潜在市场。这番表态等于承认比特币的抗通胀属性和"},
            {"time": [33.12, 36.93], "zh": "网络效应，来自美联储前主席之口，分量不轻", "text": "网络效应，来自美联储前主席之口，分量不轻"},
        ]

        polished = run_asr.polish_readable_subtitle_segments(subtitles, {"max_visible_chars": 30}, use_llm=False)

        self.assertIn(
            "他接着补充，早期参与比特币的人，会创造巨大的潜在市场。",
            [item["zh"] for item in polished],
        )
        self.assertEqual("".join(item["zh"] for item in polished), "".join(item["zh"] for item in subtitles))

    def test_reference_text_authority_balances_mid_segment_reading_time(self):
        subtitles = [
            {"time": [10.88, 16.61], "zh": "他算了一笔账：美国财务顾问管理的资产规模约7万亿美元，", "text": "他算了一笔账：美国财务顾问管理的资产规模约7万亿美元，"},
            {"time": [16.61, 19.68], "zh": "2%到3%就是1400亿到2100亿美元。", "text": "2%到3%就是1400亿到2100亿美元。"},
            {"time": [20.24, 21.7], "zh": "这么大笔资金涌入，必然推高比特币价格", "text": "这么大笔资金涌入，必然推高比特币价格"},
        ]
        reference = [
            {
                "time": [10.88, 21.7],
                "zh": "他算了一笔账：美国财务顾问管理的资产规模约7万亿美元，2%到3%就是1400亿到2100亿美元。这么大笔资金涌入，必然推高比特币价格",
            }
        ]

        authoritative = run_asr.build_reference_authority_subtitles(
            subtitles,
            reference,
            {"max_visible_chars": 30},
            use_llm=False,
        )

        tail = next(item for item in authoritative if "这么大笔资金涌入" in item["zh"])
        self.assertEqual(tail["time"][1], 21.7)
        self.assertLessEqual(tail["time"][0], 19.68)
        self.assertGreaterEqual(tail["time"][1] - tail["time"][0], 2.0)
        self.assertEqual("".join(item["zh"] for item in authoritative), reference[0]["zh"])

    def test_reference_text_authority_uses_last_numeric_anchor_inside_multi_number_segment(self):
        subtitles = [
            {"time": [0.0, 3.28], "zh": "他算了一笔账，美国财务顾问管理的资产", "text": "他算了一笔账，美国财务顾问管理的资产"},
            {"time": [3.28, 8.8], "zh": "规模约70000亿美元，2~就是1400亿到2100亿美", "text": "规模约70000亿美元，2~就是1400亿到2100亿美"},
            {"time": [9.36, 10.82], "zh": "这么大笔资金入必然推高比特币价格。", "text": "这么大笔资金入必然推高比特币价格。"},
        ]
        reference = [
            {
                "time": [0.0, 10.82],
                "zh": "他算了一笔账：美国财务顾问管理的资产规模约7万亿美元，2%到3%就是1400亿到2100亿美元。这么大笔资金涌入，必然推高比特币价格",
            }
        ]

        authoritative = run_asr.build_reference_authority_subtitles(
            subtitles,
            reference,
            {"max_visible_chars": 26},
            use_llm=False,
        )

        self.assertIn(
            "规模约7万亿美元，2%到3%就是1400亿到2100亿美元。",
            [item["zh"] for item in authoritative],
        )
        self.assertFalse(any(item["zh"] == "规模约7万亿美元，2%到3%" for item in authoritative))

    def test_reference_text_authority_merges_orphan_tts_fragments(self):
        subtitles = [
            {"time": [29.44, 30.96], "zh": "很多最新模型都基于 Hub 公开数据微调，", "text": "很多最新模型都基于 Hub 公开数据微调，"},
            {"time": [31.12, 33.92], "zh": "共享成为趋势，", "text": "共享成为趋势，"},
            {"time": [33.92, 34.4], "zh": "数据不再", "text": "数据不再"},
            {"time": [34.64, 36.16], "zh": "是稀", "text": "是稀"},
            {"time": [36.24, 37.44], "zh": "缺", "text": "缺"},
            {"time": [37.6, 38.64], "zh": "资", "text": "资"},
            {"time": [38.96, 40.24], "zh": "源", "text": "源"},
        ]
        reference = [
            {
                "time": [25.18, 40.08],
                "zh": (
                    "很多最新模型都基于 Hub 公开数据微调，"
                    "共享成为趋势，数据不再是稀缺资源"
                ),
            }
        ]

        authoritative = run_asr.build_reference_authority_subtitles(
            subtitles,
            reference,
            {"max_visible_chars": 26},
            use_llm=False,
        )

        combined_text = "".join(item["zh"] for item in authoritative)
        self.assertIn("数据不再是稀缺资源", combined_text)
        self.assertLessEqual(authoritative[-1]["time"][1], 40.08)
        self.assertNotIn("缺", [item["zh"] for item in authoritative])
        self.assertNotIn("资", [item["zh"] for item in authoritative])
        self.assertNotIn("源", [item["zh"] for item in authoritative])

    def test_reference_text_authority_falls_back_to_reference_timing_when_asr_leaves_large_gap(self):
        subtitles = [
            {"time": [23.1, 25.58], "zh": "两边各退一步，银行有机会参与，", "text": "两边各退一步，银行有机会参与，"},
            {"time": [25.58, 26.3], "zh": "Coinbase", "text": "Coinbase"},
            {"time": [26.3, 27.34], "zh": "这样的合规交易所", "text": "这样的合规交易所"},
            {"time": [27.34, 28.94], "zh": "也有了更清晰的监管路径", "text": "也有了更清晰的监管路径"},
            {"time": [31.34, 33.9], "zh": "当然，参议院标记只是第一步，后续还要全院投票和众议院协调。", "text": "当然，参议院标记只是第一步，后续还要全院投票和众议院协调。"},
            {"time": [33.9, 35.66], "zh": "但至少监管层在认真推进，", "text": "但至少监管层在认真推进，"},
            {"time": [35.66, 37.96], "zh": "加密行业终于盼来明确规则，", "text": "加密行业终于盼来明确规则，"},
            {"time": [37.96, 39.1], "zh": "不是空喊口号了", "text": "不是空喊口号了"},
        ]
        reference = [
            {
                "time": [12.49, 29.8],
                "zh": (
                    "具体来说，稳定币奖励条款是焦点。Armstrong说他们满足了银行游说和参议院的要求——"
                    "不能对闲置余额支付收益，只有活跃交易才能拿奖励。两边各退一步，银行有机会参与，"
                    "Coinbase这样的合规交易所也有了更清晰的监管路径"
                ),
            },
            {
                "time": [29.8, 39.12],
                "zh": "当然，参议院标记只是第一步，后续还要全院投票和众议院协调。但至少监管层在认真推进，加密行业终于盼来明确规则，不是空喊口号了",
            },
        ]

        authoritative = run_asr.build_reference_authority_subtitles(
            subtitles,
            reference,
            {"max_visible_chars": 26},
            use_llm=False,
        )

        self.assertTrue(
            any(item["time"][0] == 29.8 for item in authoritative),
            authoritative,
        )
        self.assertFalse(
            any(item["time"][0] == 31.34 for item in authoritative),
            authoritative,
        )
        self.assertLessEqual(
            max(next_item["time"][0] - item["time"][1] for item, next_item in zip(authoritative, authoritative[1:])),
            0.9,
        )
        combined_text = "".join(item["zh"] for item in authoritative)
        self.assertIn("当然，参议院标记只是第一步", combined_text)
        self.assertIn("不是空喊口号了", combined_text)

    def test_reference_text_authority_clamps_segment_that_crosses_reference_boundary(self):
        subtitles = [
            {"time": [21.66, 23.64], "zh": "，连之前争议很大的稳定币", "text": "，连之前争议很大的稳定币"},
            {"time": [23.64, 25.18], "zh": "问题都", "text": "问题都"},
            {"time": [25.18, 26.92], "zh": "谈出了健康妥协", "text": "谈出了健康妥协"},
            {"time": [26.92, 28.82], "zh": "对普通投资者来说，监管清晰意味着合规交易所", "text": "对普通投资者来说，监管清晰意味着合规交易所"},
            {"time": [28.82, 29.9], "zh": "可以上更多产品，", "text": "可以上更多产品，"},
        ]
        reference = [
            {
                "time": [11.94, 26.09],
                "zh": "他说的这个法案，就是给加密资产在美国建立明确的监管框架。周四就要进行标记，Armstrong称之为历史性时刻。他强调现在两党支持空前，连之前争议很大的稳定币问题都谈出了健康妥协",
            },
            {
                "time": [26.09, 44.68],
                "zh": "对普通投资者来说，监管清晰意味着合规交易所可以上更多产品，机构资金进场障碍也降低了。交易品种和成本都可能直接受影响。",
            },
        ]

        authoritative = run_asr.build_reference_authority_subtitles(
            subtitles,
            reference,
            {"max_visible_chars": 26},
            use_llm=False,
        )

        previous_block_tail = next(item for item in authoritative if "健康妥协" in item["zh"])
        next_block_head = next(item for item in authoritative if "普通投资者" in item["zh"])
        self.assertEqual(previous_block_tail["time"][1], 26.09)
        self.assertEqual(next_block_head["time"][0], 26.09)
        self.assertFalse(any((item["zh"] or "").startswith(("，", "。", "：")) for item in authoritative))
        self.assertNotIn("问题都", [item["zh"] for item in authoritative])

    def test_reference_text_authority_polishes_readable_display_groups_without_crossing_boundaries(self):
        subtitles = [
            {"time": [0.0, 2.34], "zh": "Coinbase CEO Brian Armstrong", "text": "Coinbase CEO Brian Armstrong"},
            {"time": [2.34, 3.22], "zh": "刚刚透露", "text": "刚刚透露"},
            {"time": [3.22, 6.38], "zh": "，比特币和加密市场结构法案终于达成妥协", "text": "，比特币和加密市场结构法案终于达成妥协"},
            {"time": [6.38, 8.88], "zh": "，本周就要送参议院标记了", "text": "，本周就要送参议院标记了"},
            {"time": [8.88, 10.72], "zh": "。两边都不完全满意", "text": "。两边都不完全满意"},
            {"time": [10.72, 12.64], "zh": "，但总算迈出关键一步", "text": "，但总算迈出关键一步"},
            {"time": [12.64, 13.68], "zh": "具体来说", "text": "具体来说"},
            {"time": [13.68, 15.44], "zh": "，稳定币奖励条款是焦点", "text": "，稳定币奖励条款是焦点"},
            {"time": [15.96, 16.56], "zh": "。Armstrong", "text": "。Armstrong"},
            {"time": [16.56, 19.28], "zh": "说他们满足了银行游说和参议院的要求——", "text": "说他们满足了银行游说和参议院的要求——"},
            {"time": [19.28, 21.3], "zh": "不能对闲置余额支付收益", "text": "不能对闲置余额支付收益"},
            {"time": [21.3, 23.1], "zh": "，只有活跃交易才能拿奖励", "text": "，只有活跃交易才能拿奖励"},
            {"time": [23.1, 25.58], "zh": "。两边各退一步，银行有机会参与", "text": "。两边各退一步，银行有机会参与"},
            {"time": [25.58, 26.3], "zh": "，Coinbase", "text": "，Coinbase"},
            {"time": [26.3, 27.34], "zh": "这样的合规交易所", "text": "这样的合规交易所"},
            {"time": [27.34, 29.8], "zh": "也有了更清晰的监管路径", "text": "也有了更清晰的监管路径"},
        ]
        reference = [
            {
                "time": [0.0, 12.49],
                "zh": "Coinbase CEO Brian Armstrong 刚刚透露，比特币和加密市场结构法案终于达成妥协，本周就要送参议院标记了。两边都不完全满意，但总算迈出关键一步",
            },
            {
                "time": [12.49, 29.8],
                "zh": "具体来说，稳定币奖励条款是焦点。Armstrong说他们满足了银行游说和参议院的要求——不能对闲置余额支付收益，只有活跃交易才能拿奖励。两边各退一步，银行有机会参与，Coinbase这样的合规交易所也有了更清晰的监管路径",
            },
        ]

        authoritative = run_asr.build_reference_authority_subtitles(
            subtitles,
            reference,
            {"max_visible_chars": 26},
            use_llm=False,
        )
        texts = [item["zh"] for item in authoritative]

        self.assertFalse(any(text.startswith(("，", "。", "：")) for text in texts))
        self.assertIn("Coinbase CEO Brian Armstrong刚刚透露，", texts)
        self.assertIn("Armstrong说他们满足了银行游说和参议院的要求——", texts)
        self.assertIn("具体来说，稳定币奖励条款是焦点。", texts)
        self.assertIn("Coinbase这样的合规交易所", texts)
        self.assertNotIn("刚刚透露", texts)
        self.assertNotIn("Armstrong", texts)
        self.assertNotIn("Coinbase", texts)
        self.assertTrue(any(item["time"][1] == 12.49 for item in authoritative))
        self.assertTrue(any(item["time"][0] == 12.49 for item in authoritative))
        self.assertLessEqual(
            max(next_item["time"][0] - item["time"][1] for item, next_item in zip(authoritative, authoritative[1:])),
            0.9,
        )

    def test_reference_alignment_retries_llm_for_unrepaired_protected_terms(self):
        subtitles = [
            {
                "time": [0.0, 2.5],
                "zh": "Kalshi volume is moving.",
                "en": "Kalshi volume is moving.",
                "text": "Kalshi volume is moving.",
            },
        ]
        reference = [
            {
                "time": [0.0, 2.5],
                "zh": "Kalshi 的成交量在波动。",
            }
        ]

        responses = [
            json.dumps([
                {
                    "index": 0,
                    "time": [0.0, 2.5],
                    "zh": "预测市场的成交量在波动。",
                    "en": "Kalshi volume is moving.",
                },
            ], ensure_ascii=False),
            json.dumps([
                {
                    "index": 0,
                    "time": [0.0, 2.5],
                    "zh": "Kalshi 的成交量在波动。",
                    "en": "Kalshi volume is moving.",
                }
            ], ensure_ascii=False),
        ]

        class FakeResponse:
            def __init__(self, text):
                self.text = text

        with patch("pipeline.run_asr.create_llm_client", return_value=object()), \
                patch("pipeline.run_asr.generate_content", side_effect=[FakeResponse(text) for text in responses]) as generate_content, \
                patch("pipeline.run_asr.emit_stage"):
            aligned = run_asr.align_subtitles_with_reference(subtitles, reference)

        self.assertEqual(generate_content.call_count, 2)
        self.assertEqual(aligned[0]["zh"], "Kalshi 的成交量在波动。")
        self.assertEqual(aligned[0]["text"], aligned[0]["zh"])


if __name__ == "__main__":
    unittest.main()
