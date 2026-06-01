import sys
import unittest
from pathlib import Path


PYTHON_ROOT = Path(__file__).resolve().parents[1]
python_root_str = str(PYTHON_ROOT)
if python_root_str not in sys.path:
    sys.path.insert(0, python_root_str)

from pipeline import asr_filetrans_parse


class Word:
    def __init__(self, start, end, word):
        self.start = start
        self.end = end
        self.word = word


def parse_seconds(value, *, milliseconds=False):
    number = float(value)
    if milliseconds or abs(number) >= 1000:
        number = number / 1000.0
    return round(number, 2)


class AsrFiletransParseTest(unittest.TestCase):
    def test_join_filetrans_tokens_keeps_decimal_values_together(self):
        text = asr_filetrans_parse.join_filetrans_tokens(["0", ".42", "美元"])
        self.assertEqual(text, "0.42美元")

    def test_parse_segments_collects_nested_transcripts_and_words(self):
        payload = {
            "output": {
                "results": [
                    {
                        "transcription": {
                            "transcripts": [
                                {
                                    "language": "zh",
                                    "sentences": [
                                        {
                                            "begin_time": 0,
                                            "end_time": 1500,
                                            "text": "第一句。",
                                            "words": [
                                                {"begin_time": 0, "end_time": 800, "text": "第一"},
                                                {"begin_time": 800, "end_time": 1500, "text": "句", "punctuation": "。"},
                                            ],
                                        }
                                    ],
                                }
                            ]
                        }
                    }
                ]
            }
        }

        segments, language = asr_filetrans_parse.parse_filetrans_result_segments(
            payload,
            parse_seconds=parse_seconds,
            apply_domain_corrections=lambda text: text,
            infer_language_from_text=lambda _text: "zh",
            word_factory=Word,
            include_words=True,
        )

        self.assertEqual(language, "zh")
        self.assertEqual(segments[0]["start"], 0.0)
        self.assertEqual(segments[0]["end"], 1.5)
        self.assertEqual(segments[0]["text"], "第一句。")
        self.assertEqual([(word.start, word.end, word.word) for word in segments[0]["words"]], [
            (0.0, 0.8, "第一"),
            (0.8, 1.5, "句。"),
        ])


if __name__ == "__main__":
    unittest.main()
