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
