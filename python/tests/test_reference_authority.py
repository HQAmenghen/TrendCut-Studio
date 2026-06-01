import json
import re
import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
for candidate in (PROJECT_ROOT, PYTHON_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from pipeline import reference_authority  # noqa: E402


def visible_text(text):
    return re.sub(r"[\s，。！？；：、“”‘’,.!?;:()\[\]{}\"'…·-]", "", text or "")


def subtitle_time_range(entry):
    if not isinstance(entry, dict):
        return None
    time_range = entry.get("time")
    if not isinstance(time_range, list) or len(time_range) < 2:
        time_range = [entry.get("start"), entry.get("end")]
    try:
        start = float(time_range[0])
        end = float(time_range[1])
    except (TypeError, ValueError):
        return None
    if end <= start:
        return None
    return start, end


def get_subtitle_primary_text(entry):
    if not isinstance(entry, dict):
        return ""
    return str(entry.get("zh") or entry.get("text") or entry.get("en") or "").strip()


def normalize_final_subtitles(subtitles):
    normalized = []
    for entry in subtitles or []:
        time_range = subtitle_time_range(entry)
        text = get_subtitle_primary_text(entry)
        if not time_range or not text:
            continue
        item = dict(entry)
        item["time"] = [time_range[0], time_range[1]]
        item["text"] = str(item.get("text") or text).strip()
        if str(item.get("zh") or "").strip():
            item["zh"] = str(item["zh"]).strip()
        normalized.append(item)
    return normalized


def parse_json_array_from_text(text):
    value = json.loads(text)
    return value if isinstance(value, list) else []


class FakeResponse:
    def __init__(self, text):
        self.text = text


class ReferenceAuthorityModuleTest(unittest.TestCase):
    def make_deps(self, responses=None):
        calls = {"generate_content": 0, "emit_stage": 0, "debug": []}
        responses = list(responses or [])

        def generate_content(_client, **_kwargs):
            calls["generate_content"] += 1
            return FakeResponse(responses.pop(0))

        def emit_stage(_stage, _message):
            calls["emit_stage"] += 1

        deps = reference_authority.ReferenceAuthorityDeps(
            resolve_split_config=lambda raw=None: {"max_visible_chars": int((raw or {}).get("max_visible_chars", 26))},
            reference_authority_display_limit=lambda _text="", split_config=None: split_config["max_visible_chars"],
            merge_reference_authority_micro_asr_fragments=lambda entries: list(entries or []),
            subtitle_time_range=subtitle_time_range,
            get_subtitle_primary_text=get_subtitle_primary_text,
            apply_domain_corrections=lambda text: str(text or "").strip(),
            normalize_final_subtitles=normalize_final_subtitles,
            visible_text=visible_text,
            parse_json_array_from_text=parse_json_array_from_text,
            get_text_model_for_provider=lambda _provider: "fake-model",
            create_llm_client=lambda provider=None: {"provider": provider},
            generate_content=generate_content,
            get_text_llm_provider=lambda: "fake-provider",
            emit_stage=emit_stage,
            append_debug_event=lambda event: calls["debug"].append(event),
        )
        return deps, calls

    def test_validate_accepts_direct_llm_subtitle_json(self):
        deps, _calls = self.make_deps()
        results = [
            {"time": [0, 1], "zh": "支持加密持有者，"},
            {"time": [1, 2], "zh": "保护比特币未来"},
        ]

        subtitles = reference_authority.validate_direct_reference_authority_subtitles(
            results,
            "支持加密持有者，保护比特币未来",
            deps,
        )

        self.assertEqual("".join(item["zh"] for item in subtitles), "支持加密持有者，保护比特币未来")
        self.assertEqual([item["time"] for item in subtitles], [[0.0, 1.0], [1.0, 2.0]])

    def test_validate_rejects_text_not_matching_reference(self):
        deps, _calls = self.make_deps()
        results = [{"time": [0, 2], "zh": "support holders"}]

        subtitles = reference_authority.validate_direct_reference_authority_subtitles(
            results,
            "支持持有者",
            deps,
        )

        self.assertEqual(subtitles, [])

    def test_build_without_llm_returns_sorted_normalized_reference_subtitles(self):
        deps, calls = self.make_deps()
        asr_subtitles = [{"time": [0, 2], "text": "raw"}, {"time": [2, 3], "text": "more"}]
        reference_subtitles = [
            {"time": [1, 2], "zh": "第二段"},
            {"time": [0, 1], "zh": "第一段"},
        ]

        subtitles = reference_authority.build_reference_authority_subtitles(
            asr_subtitles,
            reference_subtitles,
            deps,
            use_llm=False,
            strict=True,
        )

        self.assertEqual([item["zh"] for item in subtitles], ["第一段", "第二段"])
        self.assertEqual(calls["generate_content"], 0)


if __name__ == "__main__":
    unittest.main()
