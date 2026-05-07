"""
Structured vector retriever for script-to-evidence matching.

Priority:
1. Qwen native embedding API (`text-embedding-v4`)
2. Local sparse TF-IDF cosine fallback
"""

from __future__ import annotations

import math
import os
import re
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

try:
    from ...qwen_client import (
        create_qwen_client,
        generate_embeddings,
        generate_multimodal_embeddings,
        get_qwen_embedding_model,
        get_qwen_multimodal_embedding_model,
    )
except Exception:
    try:
        from qwen_client import create_qwen_client, generate_embeddings, generate_multimodal_embeddings, get_qwen_embedding_model, get_qwen_multimodal_embedding_model
    except Exception:
        create_qwen_client = None
        generate_embeddings = None
        generate_multimodal_embeddings = None
        get_qwen_embedding_model = None
        get_qwen_multimodal_embedding_model = None

try:
    from ...load_env import load_project_env
except Exception:
    try:
        from load_env import load_project_env
    except Exception:
        load_project_env = None


def _normalize_string_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    normalized = []
    seen = set()
    for item in value:
        text = str(item or "").strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(text)
    return normalized


def _entity_names(items: Any) -> List[str]:
    if not isinstance(items, list):
        return []
    names = []
    for item in items:
        if isinstance(item, dict):
            name = str(item.get("name") or "").strip()
            if name:
                names.append(name)
            if isinstance(item.get("alias"), list):
                names.extend(_normalize_string_list(item.get("alias")))
        else:
            text = str(item or "").strip()
            if text:
                names.append(text)
    return _normalize_string_list(names)


def _tokenize(text: str) -> List[str]:
    text = str(text or "").lower().strip()
    if not text:
        return []
    normalized = re.sub(r"[^\w\u4e00-\u9fff]+", " ", text)
    tokens = [tok for tok in normalized.split() if tok]
    expanded: List[str] = []
    for token in tokens:
        expanded.append(token)
        if re.search(r"[\u4e00-\u9fff]", token):
            chars = [ch for ch in token if re.search(r"[\u4e00-\u9fff]", ch)]
            expanded.extend(chars)
            if len(chars) >= 2:
                expanded.extend("".join(chars[idx:idx + 2]) for idx in range(len(chars) - 1))
    return expanded


def _sparse_cosine(query_vec: Dict[str, float], doc_vec: Dict[str, float]) -> float:
    if not query_vec or not doc_vec:
        return 0.0
    dot = sum(weight * doc_vec.get(token, 0.0) for token, weight in query_vec.items())
    query_norm = math.sqrt(sum(weight * weight for weight in query_vec.values()))
    doc_norm = math.sqrt(sum(weight * weight for weight in doc_vec.values()))
    if query_norm <= 0 or doc_norm <= 0:
        return 0.0
    return dot / (query_norm * doc_norm)


def _dense_cosine(query_vec: List[float], doc_vec: List[float]) -> float:
    if not query_vec or not doc_vec or len(query_vec) != len(doc_vec):
        return 0.0
    dot = sum(float(a) * float(b) for a, b in zip(query_vec, doc_vec))
    query_norm = math.sqrt(sum(float(a) * float(a) for a in query_vec))
    doc_norm = math.sqrt(sum(float(b) * float(b) for b in doc_vec))
    if query_norm <= 0 or doc_norm <= 0:
        return 0.0
    return dot / (query_norm * doc_norm)


class StructuredVectorRetriever:
    def __init__(self, top_k: int = 5):
        self.top_k = max(1, int(top_k or 5))
        self.embedding_client = None
        self.use_multimodal = os.getenv("QWEN_USE_MULTIMODAL_EMBEDDING", "1").strip().lower() not in {"0", "false", "no", "off"}
        if self.use_multimodal and callable(get_qwen_multimodal_embedding_model):
            self.embedding_model = get_qwen_multimodal_embedding_model()
        else:
            self.embedding_model = (
                get_qwen_embedding_model() if callable(get_qwen_embedding_model) else "text-embedding-v4"
            )
            self.use_multimodal = False
        if not (os.getenv("QWEN_API_KEY") or os.getenv("DASHSCOPE_API_KEY")):
            try:
                if callable(load_project_env):
                    load_project_env(__file__)
            except Exception:
                pass
        self.embedding_enabled = (
            create_qwen_client is not None
            and generate_embeddings is not None
            and bool(os.getenv("QWEN_API_KEY") or os.getenv("DASHSCOPE_API_KEY"))
        )
        self.last_error: Optional[str] = None
        self.method = "sparse"
        if self.embedding_enabled:
            try:
                self.embedding_client = create_qwen_client()
                self.method = "qwen_embedding"
            except Exception as exc:
                self.embedding_enabled = False
                self.last_error = str(exc)
                self.method = "sparse"

    def _build_script_query_text(self, unit: Dict[str, Any]) -> str:
        evidence = unit.get("evidence") or {}
        must_match = evidence.get("must_match") or {}
        parts = [
            str(evidence.get("evidence_query") or unit.get("text") or "").strip(),
            str((unit.get("content_intent") or {}).get("core_claim") or "").strip(),
        ]
        parts.extend(_normalize_string_list(must_match.get("persons")))
        parts.extend(_normalize_string_list(must_match.get("orgs")))
        parts.extend(_normalize_string_list(must_match.get("assets")))
        parts.extend(_normalize_string_list(must_match.get("event_types")))
        parts.extend(_normalize_string_list(must_match.get("event_tags")))
        polarity = str(must_match.get("polarity") or "").strip()
        if polarity and polarity != "na":
            parts.append(polarity)
        return re.sub(r"\s+", " ", " ".join(part for part in parts if part)).strip()

    def _build_segment_text(self, segment: Dict[str, Any]) -> str:
        content = segment.get("content") or {}
        entities = segment.get("entities") or {}
        event = segment.get("event") or {}
        visual = segment.get("visual") or {}
        parts = [
            str(content.get("semantic_text") or "").strip(),
            str(content.get("asr_text") or segment.get("text") or "").strip(),
            str(content.get("ocr_text") or "").strip(),
            str(content.get("visual_summary") or segment.get("visual_summary") or "").strip(),
        ]
        parts.extend(_entity_names(entities.get("persons")))
        parts.extend(_entity_names(entities.get("orgs")))
        parts.extend(_entity_names(entities.get("assets")))
        parts.extend(_normalize_string_list(event.get("event_tags")))
        if event.get("event_type"):
            parts.append(str(event.get("event_type")))
        if event.get("polarity") and str(event.get("polarity")) != "na":
            parts.append(str(event.get("polarity")))
        if visual.get("visual_type"):
            parts.append(str(visual.get("visual_type")))
        return re.sub(r"\s+", " ", " ".join(part for part in parts if part)).strip()

    def _build_sparse_vectors(self, script_queries: List[str], segment_texts: List[str]) -> Tuple[List[Dict[str, float]], List[Dict[str, float]]]:
        doc_tokens = [Counter(_tokenize(text)) for text in segment_texts]
        query_tokens = [Counter(_tokenize(text)) for text in script_queries]
        doc_freq = Counter()
        for counts in doc_tokens:
            doc_freq.update(counts.keys())
        total_docs = max(1, len(doc_tokens))

        def make_vector(counter: Counter) -> Dict[str, float]:
            vector: Dict[str, float] = {}
            total_terms = max(1, sum(counter.values()))
            for token, count in counter.items():
                idf = math.log((1 + total_docs) / (1 + doc_freq.get(token, 0))) + 1.0
                tf = count / total_terms
                vector[token] = tf * idf
            return vector

        return [make_vector(counter) for counter in query_tokens], [make_vector(counter) for counter in doc_tokens]

    def _embed_texts(self, texts: List[str]) -> Optional[List[List[float]]]:
        if not self.embedding_enabled or self.embedding_client is None:
            return None
        try:
            if self.use_multimodal and generate_multimodal_embeddings is not None:
                inputs = [{"text": t} for t in texts]
                return generate_multimodal_embeddings(
                    self.embedding_client,
                    model=self.embedding_model,
                    inputs=inputs,
                )
            if generate_embeddings is not None:
                return generate_embeddings(
                    self.embedding_client,
                    model=self.embedding_model,
                    texts=texts,
                )
            return None
        except Exception as exc:
            self.last_error = str(exc)
            self.embedding_enabled = False
            self.method = "sparse"
            return None

    def retrieve(self, script_units: List[Dict[str, Any]], segments: List[Dict[str, Any]]) -> Dict[str, Any]:
        script_queries = [self._build_script_query_text(unit) for unit in script_units]
        segment_texts = [self._build_segment_text(segment) for segment in segments]
        query_vectors = None
        segment_vectors = None

        if script_queries and segment_texts:
            query_vectors = self._embed_texts(script_queries)
            if query_vectors:
                segment_vectors = self._embed_texts(segment_texts)

        if not query_vectors or not segment_vectors or len(query_vectors) != len(script_units) or len(segment_vectors) != len(segments):
            query_vectors, segment_vectors = self._build_sparse_vectors(script_queries, segment_texts)
            self.method = "sparse"

        retrievals = []
        by_script: Dict[str, List[Dict[str, Any]]] = {}
        for idx, unit in enumerate(script_units):
            script_ref = str(unit.get("id") or f"script_{idx + 1:03d}")
            candidates = []
            for seg_idx, segment in enumerate(segments):
                if self.method == "qwen_embedding" and query_vectors and segment_vectors and isinstance(query_vectors[idx], list):
                    cosine = _dense_cosine(query_vectors[idx], segment_vectors[seg_idx])
                else:
                    cosine = _sparse_cosine(query_vectors[idx], segment_vectors[seg_idx])
                candidates.append({
                    "segment_id": segment.get("id"),
                    "cosine_similarity": round(float(cosine), 4),
                    "vector_rank": 0,
                })
            candidates.sort(key=lambda item: item["cosine_similarity"], reverse=True)
            top_candidates = candidates[:self.top_k]
            for rank, candidate in enumerate(top_candidates, start=1):
                candidate["vector_rank"] = rank
            retrieval_record = {
                "script_ref": script_ref,
                "query": {
                    "evidence_query": script_queries[idx],
                    "query_embedding_model": self.embedding_model if self.method == "qwen_embedding" else "local_sparse_tfidf",
                    "retrieval_method": self.method,
                },
                "candidates": top_candidates,
            }
            retrievals.append(retrieval_record)
            by_script[script_ref] = top_candidates

        return {
            "retrievals": retrievals,
            "by_script": by_script,
            "decision_meta": {
                "retrieval_method": self.method,
                "embedding_model": self.embedding_model if self.method == "qwen_embedding" else "local_sparse_tfidf",
                "retrieval_error": self.last_error,
            },
        }
