"""Build reusable ASR timing artifacts for synthesized narration audio."""

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path


PYTHON_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

from script_protocol import emit_result, emit_stage, run_guarded  # noqa: E402

from pipeline.run_asr import (  # noqa: E402
    MockSegment,
    WhisperModel,
    apply_domain_corrections,
    build_raw_subtitles,
    expand_filetrans_transcription_urls,
    get_qwen_asr_model,
    infer_language_from_text,
    parse_filetrans_result_segments,
    resolve_filetrans_file_url,
    split_segment_words,
    submit_qwen_filetrans_task,
    wait_qwen_filetrans_task,
)


def read_text_file(path: Path) -> str:
    if not path or not path.exists():
        return ""
    return path.read_text(encoding="utf-8").strip()


def write_json_file(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def hash_file(path: Path) -> str:
    digest = hashlib.sha1()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def word_to_dict(word, index: int, segment_index: int) -> dict:
    return {
        "index": index,
        "segmentIndex": segment_index,
        "start": round(float(getattr(word, "start", 0.0) or 0.0), 3),
        "end": round(float(getattr(word, "end", 0.0) or 0.0), 3),
        "text": str(getattr(word, "word", "") or "").strip(),
    }


def normalize_segments(raw_segments: list[dict]) -> tuple[list[dict], list[dict]]:
    segments = []
    words = []
    word_index = 0
    for segment_index, segment in enumerate(raw_segments or []):
        text = apply_domain_corrections(str(segment.get("text") or "").strip())
        start = float(segment.get("start", 0.0) or 0.0)
        end = float(segment.get("end", start) or start)
        if not text or end <= start:
            continue
        segments.append({
            "id": f"speech_{len(segments) + 1:03d}",
            "start": round(start, 3),
            "end": round(end, 3),
            "duration": round(end - start, 3),
            "text": text,
        })
        for word in segment.get("words") or []:
            item = word_to_dict(word, word_index, segment_index)
            if item["text"] and item["end"] > item["start"]:
                words.append(item)
                word_index += 1
    return segments, words


def transcribe_with_filetrans(audio_path: Path, file_url: str = "") -> tuple[list[dict], str, str, str]:
    resolved_url, _object_key = resolve_filetrans_file_url(str(audio_path), file_url)
    if not resolved_url:
        return [], "", "", ""
    model = get_qwen_asr_model()
    emit_stage("speech_alignment_asr", f"正在进行 Qwen Filetrans 口播对齐: {model}")
    task_id, headers = submit_qwen_filetrans_task(resolved_url, model)
    payload = wait_qwen_filetrans_task(task_id, headers)
    payload = expand_filetrans_transcription_urls(payload, headers=headers)
    raw_segments, language = parse_filetrans_result_segments(payload, include_words=True)
    return raw_segments, language, "qwen_filetrans", model


def transcribe_with_whisper(audio_path: Path) -> tuple[list[dict], str, str, str]:
    model_name = os.getenv("SPEECH_ALIGNMENT_WHISPER_MODEL", "small")
    emit_stage("speech_alignment_asr", f"正在进行 Whisper 口播对齐: {model_name}")
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        str(audio_path),
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
    )
    detected_language = str(getattr(info, "language", "") or "").strip().lower()
    raw_segments = []
    for segment in segments:
        words = list(getattr(segment, "words", None) or [])
        if words:
            raw_segments.append({
                "start": float(getattr(segment, "start", 0.0) or 0.0),
                "end": float(getattr(segment, "end", 0.0) or 0.0),
                "text": str(getattr(segment, "text", "") or "").strip(),
                "words": words,
            })
            continue
        for item in split_segment_words(segment):
            raw_segments.append(item)
    return raw_segments, detected_language, "whisper", model_name


def split_segments_for_subtitles(raw_segments: list[dict]) -> list[dict]:
    chunks = []
    for segment in raw_segments:
        words = segment.get("words") if isinstance(segment, dict) else None
        if words:
            chunks.extend(split_segment_words(
                MockSegment(segment.get("start", 0.0), segment.get("end", 0.0), segment.get("text", ""), words),
                allow_clause_breaks=True,
            ))
        else:
            chunks.append({
                "start": float(segment.get("start", 0.0) or 0.0),
                "end": float(segment.get("end", 0.0) or 0.0),
                "text": apply_domain_corrections(str(segment.get("text") or "").strip()),
            })
    return chunks


def build_alignment(audio_path: Path, narration_path: Path, file_url: str = "") -> tuple[dict, list[dict]]:
    raw_segments = []
    language = ""
    provider = ""
    model = ""
    if os.getenv("SPEECH_ALIGNMENT_FILETRANS", "1").strip().lower() not in {"0", "false", "no", "off"}:
        try:
            raw_segments, language, provider, model = transcribe_with_filetrans(audio_path, file_url=file_url)
        except Exception as exc:
            print(f"   ⚠️ Qwen Filetrans 口播对齐失败，降级 Whisper: {exc}", file=sys.stderr)

    if not raw_segments:
        raw_segments, language, provider, model = transcribe_with_whisper(audio_path)

    segments, words = normalize_segments(raw_segments)
    sample_text = "".join(segment["text"] for segment in segments)
    if not language:
        language = infer_language_from_text(sample_text) or "zh"
    subtitle_segments = split_segments_for_subtitles(raw_segments)
    subtitles = build_raw_subtitles(subtitle_segments, language)
    duration = max([segment["end"] for segment in segments], default=0.0)
    narration_text = read_text_file(narration_path)
    payload = {
        "version": 1,
        "inputType": "speech_alignment",
        "provider": provider,
        "model": model,
        "language": language,
        "duration": round(duration, 3),
        "narrationText": narration_text,
        "audioSha1": hash_file(audio_path),
        "narrationSha1": hashlib.sha1(narration_text.encode("utf-8")).hexdigest(),
        "segments": segments,
        "words": words,
    }
    payload["signature"] = hashlib.sha1(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return payload, subtitles


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build speech alignment artifacts")
    parser.add_argument("--audio", required=True, help="Final narration audio path")
    parser.add_argument("--narration-text", required=True, help="Final narration speech text path")
    parser.add_argument("--alignment-output", required=True, help="Output speech_alignment.json path")
    parser.add_argument("--subtitles-output", required=True, help="Output speech_subtitles.json path")
    parser.add_argument("--meta-output", required=True, help="Output speech_alignment_meta.json path")
    parser.add_argument("--file-url", default="", help="Optional public URL for Qwen Filetrans")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    audio_path = Path(args.audio)
    narration_path = Path(args.narration_text)
    if not audio_path.exists():
        raise FileNotFoundError(f"口播音频不存在: {audio_path}")
    if not narration_path.exists():
        raise FileNotFoundError(f"口播文本不存在: {narration_path}")

    alignment, subtitles = build_alignment(audio_path, narration_path, file_url=args.file_url)
    write_json_file(Path(args.alignment_output), alignment)
    write_json_file(Path(args.subtitles_output), subtitles)
    meta = {
        "version": 1,
        "audioPath": str(audio_path),
        "narrationTextPath": str(narration_path),
        "audioSha1": alignment["audioSha1"],
        "narrationSha1": alignment["narrationSha1"],
        "alignmentPath": str(args.alignment_output),
        "subtitlesPath": str(args.subtitles_output),
        "provider": alignment["provider"],
        "model": alignment["model"],
        "language": alignment["language"],
        "duration": alignment["duration"],
        "segmentCount": len(alignment["segments"]),
        "wordCount": len(alignment["words"]),
        "signature": alignment["signature"],
    }
    write_json_file(Path(args.meta_output), meta)
    emit_result(
        "speech alignment generated",
        alignmentPath=str(args.alignment_output),
        subtitlesPath=str(args.subtitles_output),
        metaPath=str(args.meta_output),
        segmentCount=len(alignment["segments"]),
        wordCount=len(alignment["words"]),
        signature=alignment["signature"],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(run_guarded(
        main,
        error_code="SPEECH_ALIGNMENT_FAILED",
        error_message="口播 ASR 对齐失败",
        error_stage="speech_alignment",
    ))
