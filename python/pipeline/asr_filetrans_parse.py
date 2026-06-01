"""Parsing helpers for Qwen Filetrans transcription payloads."""
import re


def collect_transcripts(payload):
    transcripts = []
    if isinstance(payload, dict):
        candidate = payload.get("transcripts")
        if isinstance(candidate, list):
            transcripts.extend(item for item in candidate if isinstance(item, dict))
        for value in payload.values():
            transcripts.extend(collect_transcripts(value))
    elif isinstance(payload, list):
        for item in payload:
            transcripts.extend(collect_transcripts(item))
    return transcripts


def sentence_time_range(sentence, parse_seconds):
    if "begin_time" in sentence:
        start = parse_seconds(sentence.get("begin_time"), milliseconds=True)
        end = parse_seconds(sentence.get("end_time", sentence.get("end")), milliseconds=True)
    else:
        start = parse_seconds(sentence.get("start_time", sentence.get("start")), milliseconds=False)
        end = parse_seconds(sentence.get("end_time", sentence.get("end")), milliseconds=False)
    if start is None or end is None or end <= start:
        return None
    return start, end


def should_insert_filetrans_space(current_text, token):
    if not current_text or not token:
        return False

    first_char = token[0]
    if not re.match(r"[A-Za-z0-9$]", first_char):
        return False

    previous_char = current_text[-1]
    if previous_char in ".,，" and len(current_text) >= 2 and current_text[-2].isdigit() and first_char.isdigit():
        return False

    return bool(re.search(r"[A-Za-z0-9%\)]$", current_text) or previous_char in ".,!?;:")


def join_filetrans_tokens(tokens):
    parts = []
    for token in tokens:
        token_text = str(token or "").strip()
        if not token_text:
            continue
        current_text = "".join(parts)
        if should_insert_filetrans_space(current_text, token_text):
            parts.append(" ")
        parts.append(token_text)
    return "".join(parts).strip()


def reconstruct_filetrans_words(words):
    tokens = []
    has_punctuation = False
    for word in words:
        if not isinstance(word, dict):
            continue
        token = str(word.get("text") or word.get("word") or "").strip()
        punctuation = str(word.get("punctuation") or "").strip()
        if not token:
            continue
        if punctuation and not token.endswith(punctuation):
            token = f"{token}{punctuation}"
            has_punctuation = True
        elif punctuation:
            has_punctuation = True
        tokens.append(token)
    return join_filetrans_tokens(tokens), has_punctuation


def sentence_text(sentence, apply_domain_corrections):
    words = sentence.get("words")
    if isinstance(words, list):
        reconstructed, has_punctuation = reconstruct_filetrans_words(words)
        raw_text = str(sentence.get("text") or sentence.get("sentence") or sentence.get("sentence_text") or "").strip()
        if reconstructed and (
            has_punctuation
            or not raw_text
            or (" " in reconstructed and " " not in raw_text)
        ):
            return apply_domain_corrections(reconstructed)

    text = str(sentence.get("text") or sentence.get("sentence") or sentence.get("sentence_text") or "").strip()
    if text:
        return apply_domain_corrections(text)
    return ""


def parse_word_seconds(word, start_keys, parse_seconds, *, default=None):
    for key in start_keys:
        if key in word:
            return parse_seconds(word.get(key), milliseconds=(key in {"begin_time", "end_time"}))
    return default


def sentence_words(sentence, parse_seconds, word_factory):
    words = sentence.get("words")
    if not isinstance(words, list):
        return []

    parsed = []
    for word in words:
        if not isinstance(word, dict):
            continue
        text = str(word.get("text") or word.get("word") or "").strip()
        punctuation = str(word.get("punctuation") or "").strip()
        if punctuation and text and not text.endswith(punctuation):
            text = f"{text}{punctuation}"
        start = parse_word_seconds(word, ("begin_time", "start_time", "start"), parse_seconds)
        end = parse_word_seconds(word, ("end_time", "end"), parse_seconds)
        if not text or start is None or end is None or end <= start:
            continue
        parsed.append(word_factory(start, end, text))
    return parsed


def parse_filetrans_result_segments(
    payload,
    *,
    parse_seconds,
    apply_domain_corrections,
    infer_language_from_text,
    word_factory,
    include_words=False,
):
    raw_segments = []
    detected_language = ""
    transcript_text_parts = []

    for transcript in collect_transcripts(payload):
        language = str(
            transcript.get("language")
            or transcript.get("language_code")
            or transcript.get("detected_language")
            or ""
        ).strip().lower()
        if language and not detected_language:
            detected_language = language
        transcript_text = str(transcript.get("text") or "").strip()
        if transcript_text:
            transcript_text_parts.append(transcript_text)
        sentences = transcript.get("sentences") or transcript.get("sentence")
        if not isinstance(sentences, list):
            continue
        for sentence in sentences:
            if not isinstance(sentence, dict):
                continue
            time_range = sentence_time_range(sentence, parse_seconds)
            text = sentence_text(sentence, apply_domain_corrections)
            if not time_range or not text:
                continue
            segment = {
                "start": time_range[0],
                "end": time_range[1],
                "text": text
            }
            if include_words:
                words = sentence_words(sentence, parse_seconds, word_factory)
                if words:
                    segment["words"] = words
            raw_segments.append(segment)
            if not detected_language:
                detected_language = str(sentence.get("language") or sentence.get("language_code") or "").strip().lower()

    raw_segments.sort(key=lambda item: (item["start"], item["end"]))
    if not detected_language:
        sample_text = "".join(item["text"] for item in raw_segments) or "".join(transcript_text_parts)
        detected_language = infer_language_from_text(sample_text) or "zh"
    return raw_segments, detected_language
