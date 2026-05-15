"""
智能视频合成器

核心功能:
1. 数字人主讲片段剪辑
2. 静音素材插片 + 数字人口播音轨
3. 硬件加速 + 智能Fallback
4. 最终时间线合成
"""

import os
import json
import subprocess
import math
import re
import copy
from pathlib import Path
from typing import List, Dict, Optional, Tuple
# MoviePy 2.x 移除了 moviepy.editor 入口；这里做双版本兼容
try:
    from moviepy import (
        VideoFileClip, AudioFileClip, ColorClip, CompositeVideoClip,
        CompositeAudioClip, concatenate_videoclips, concatenate_audioclips
    )
except ImportError:  # pragma: no cover - 兼容旧版
    from moviepy.editor import (
        VideoFileClip, AudioFileClip, ColorClip, CompositeVideoClip,
        CompositeAudioClip, concatenate_videoclips, concatenate_audioclips
    )
from moviepy.video.VideoClip import TextClip
from moviepy.video.VideoClip import ImageClip
import logging

try:
    from .video_clip_engine import VideoClipEngine
except Exception:
    try:
        from video_clip_engine import VideoClipEngine
    except Exception:
        # 兼容当前仓库 video_clip_engine 只有函数、没有类 的情况
        try:
            from . import video_clip_engine as _video_clip_engine
        except Exception:
            import video_clip_engine as _video_clip_engine

        class VideoClipEngine:
            def __init__(self):
                self.hwaccel_type = _video_clip_engine.check_hardware_acceleration()

            def get_encoder_config(self):
                cfg = _video_clip_engine.get_encoder_config(self.hwaccel_type)
                codec = cfg.get('video_codec', 'libx264')
                preset = cfg.get('preset', 'medium')
                quality_param = cfg.get('quality_param', 'crf')
                quality_value = str(cfg.get('quality_value', '23'))
                args = ['-c:v', codec, '-preset', preset]
                if quality_param == 'cq':
                    args.extend(['-cq', quality_value])
                elif quality_param == 'global_quality':
                    args.extend(['-global_quality', quality_value])
                elif quality_param == 'b:v':
                    args.extend(['-b:v', quality_value])
                elif quality_param == 'qp_i':
                    args.extend(['-qp_i', quality_value])
                else:
                    args.extend(['-crf', quality_value])
                return args

try:
    from .audio_processor import AudioProcessor
except ImportError:  # 兼容直接脚本运行
    from audio_processor import AudioProcessor

try:
    from .skills.prompt_skill_loader import load_prompt_text
except Exception:
    try:
        from skills.prompt_skill_loader import load_prompt_text
    except Exception:
        load_prompt_text = None

try:
    from ..qwen_client import create_qwen_client, generate_content as qwen_generate_content
except Exception:
    try:
        from qwen_client import create_qwen_client, generate_content as qwen_generate_content
    except Exception:
        create_qwen_client = None
        qwen_generate_content = None

try:
    from ..gemini_client import create_gemini_client, generate_content as gemini_generate_content
except Exception:
    try:
        from gemini_client import create_gemini_client, generate_content as gemini_generate_content
    except Exception:
        create_gemini_client = None
        gemini_generate_content = None

logger = logging.getLogger(__name__)

MUSIC_SELECTOR_PROMPT = (
    load_prompt_text("music_selector_skill.md")
    if load_prompt_text is not None
    else ""
)


class SmartVideoComposer:
    """智能视频合成器"""

    def __init__(self, work_dir: str):
        self.work_dir = Path(work_dir)
        self.repo_root = Path(__file__).resolve().parents[2]
        self._load_local_env_files()
        self.clip_engine = VideoClipEngine()
        self.audio_processor = AudioProcessor()
        # 轻微软转场，默认关闭重叠拼接，优先保证数字人口型与口播同步。
        try:
            self.crossfade_seconds = max(0.0, float(os.getenv("SMART_CLIP_CROSSFADE_SECONDS", "0.0")))
        except Exception:
            self.crossfade_seconds = 0.0
        self.target_width = self._read_int_env("SMART_CLIP_TARGET_WIDTH", 0)
        self.target_height = self._read_int_env("SMART_CLIP_TARGET_HEIGHT", 0)
        self.transition_seconds = self._read_float_env("SMART_CLIP_TRANSITION_SECONDS", 0.12)
        self.music_index_path = self.repo_root / "config" / "music_index.json"
        self.music_library_dir = self.repo_root / "data" / "music_library"
        self.bgm_global_boost_db = self._read_float_env("SMART_CLIP_BGM_GLOBAL_BOOST_DB", 5.0)
        self.voice_priority_boost_db = self._read_float_env("SMART_CLIP_VOICE_PRIORITY_BOOST_DB", 3.0)
        self.voice_bgm_gap_db = self._read_float_env("SMART_CLIP_VOICE_BGM_GAP_DB", 11.0)
        self.bgm_min_lufs = self._read_lufs_env("SMART_CLIP_BGM_MIN_LUFS", -34.0)
        self.bgm_max_lufs = self._read_lufs_env("SMART_CLIP_BGM_MAX_LUFS", -19.0)
        if self.bgm_min_lufs > self.bgm_max_lufs:
            self.bgm_min_lufs, self.bgm_max_lufs = self.bgm_max_lufs, self.bgm_min_lufs
        self.voice_target_lufs = self._read_lufs_env("SMART_CLIP_VOICE_TARGET_LUFS", -16.0)
        self.voice_max_boost_db = self._read_float_env("SMART_CLIP_VOICE_MAX_BOOST_DB", 14.0)
        self.auto_bgm_enabled = self._read_bool_env("SMART_CLIP_AUTO_BGM_ENABLED", True)
        self.music_llm_enabled = os.getenv("SMART_CLIP_MUSIC_LLM_ENABLED", "1").strip().lower() not in {"0", "false", "off"}
        default_provider = os.getenv("LLM_PROVIDER", "auto").strip().lower() or "auto"
        default_qwen_model = os.getenv("QWEN_TEXT_MODEL", "qwen3.6-plus").strip() or "qwen3.6-plus"
        self.music_llm_provider = os.getenv("SMART_CLIP_MUSIC_LLM_PROVIDER", default_provider).strip().lower() or "auto"
        self.music_llm_model = os.getenv("SMART_CLIP_MUSIC_LLM_MODEL", default_qwen_model).strip() or default_qwen_model

    def _load_local_env_files(self) -> None:
        for env_path in (self.repo_root / ".env", self.repo_root / ".env.smart_clip"):
            try:
                if not env_path.exists():
                    continue
                for raw_line in env_path.read_text(encoding="utf-8").splitlines():
                    line = raw_line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, value = line.split("=", 1)
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = value
            except Exception as e:
                logger.warning(f"加载环境文件失败 {env_path}: {e}")

    def _clamp(self, value: float, minimum: float, maximum: float) -> float:
        return max(minimum, min(maximum, value))

    def _read_int_env(self, key: str, default: int) -> int:
        try:
            value = int(os.getenv(key, str(default)))
            return value if value > 0 else default
        except Exception:
            return default

    def _read_float_env(self, key: str, default: float) -> float:
        try:
            value = float(os.getenv(key, str(default)))
            return value if value >= 0 else default
        except Exception:
            return default

    def _read_lufs_env(self, key: str, default: float) -> float:
        try:
            return float(os.getenv(key, str(default)))
        except Exception:
            return default

    def _read_bool_env(self, key: str, default: bool) -> bool:
        raw = os.getenv(key)
        if raw is None:
            return default
        return str(raw).strip().lower() not in {"0", "false", "off", "no", ""}

    def _safe_slug(self, value: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", "_", str(value or "").lower()).strip("_")
        return slug or "track"

    def _load_music_index(self) -> Dict:
        try:
            if self.music_index_path.exists():
                return json.loads(self.music_index_path.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning(f"读取 music_index 失败: {e}")
        return {}

    def _extract_project_text(self) -> str:
        candidates = [
            self.work_dir / "script_units.json",
            self.work_dir / "narration.json",
            self.work_dir / "edit_plan.json"
        ]
        texts = []
        for path in candidates:
            try:
                if path.exists():
                    texts.append(path.read_text(encoding="utf-8"))
            except Exception:
                continue
        return "\n".join(texts).lower()

    def _extract_project_music_brief(self, max_chars: int = 1800) -> str:
        raw_text = self._extract_project_text()
        if not raw_text:
            return ""
        compact = re.sub(r"\s+", " ", raw_text).strip()
        return compact[:max_chars]

    def _infer_project_topics(self) -> List[str]:
        text = self._extract_project_text()
        if not text:
            return ["technology", "business"]

        topic_rules = {
            "finance": [
                "finance", "financial", "财经", "金融", "市场", "宏观", "利率", "货币", "美元", "支付"
            ],
            "business": [
                "business", "company", "corporate", "商业", "公司", "战略", "增长", "盈利", "收入", "团队"
            ],
            "technology": [
                "technology", "tech", "技术", "科技", "系统", "架构", "平台", "软件", "网络", "芯片"
            ],
            "crypto": [
                "crypto", "bitcoin", "defi", "web3", "blockchain", "token", "加密", "比特币", "稳定币", "区块链"
            ],
            "ai": [
                "ai", "artificial intelligence", "model", "agent", "llm", "人工智能", "模型", "智能体", "大模型"
            ]
        }
        scored = []
        for topic, keywords in topic_rules.items():
            score = sum(text.count(keyword.lower()) for keyword in keywords)
            if score > 0:
                scored.append((topic, score))
        if not scored:
            return ["technology", "business"]
        scored.sort(key=lambda item: item[1], reverse=True)
        return [topic for topic, _ in scored[:3]]

    def _resolve_music_file(self, track: Dict) -> Optional[Path]:
        extensions = [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"]
        local_file = track.get("local_file")
        if local_file:
            candidate = Path(local_file)
            if not candidate.is_absolute():
                candidate = self.repo_root / candidate
            if candidate.exists():
                return candidate

        track_id = str(track.get("id") or "").strip()
        title_slug = self._safe_slug(track.get("title") or "")
        provider = self._safe_slug(track.get("provider") or "")
        search_bases = [track_id, title_slug, f"{provider}_{title_slug}".strip("_")]

        for base in search_bases:
            if not base:
                continue
            for ext in extensions:
                candidate = self.music_library_dir / f"{base}{ext}"
                if candidate.exists():
                    return candidate

        if self.music_library_dir.exists():
            for file in self.music_library_dir.iterdir():
                if file.is_file() and file.suffix.lower() in extensions:
                    name = file.stem.lower()
                    if track_id and track_id.lower() in name:
                        return file
                    if title_slug and title_slug in self._safe_slug(name):
                        return file
        return None

    def _score_music_track(self, track: Dict, project_topics: List[str], target_duration: float = 0.0) -> int:
        short_form = target_duration > 0 and target_duration <= 30.0
        score = 0
        track_topics = set(track.get("topics") or [])
        track_use_cases = set(track.get("use_cases") or [])
        track_moods = set(track.get("moods") or [])
        topic_fit_keys = {
            "finance": "finance_fit",
            "business": None,
            "technology": None,
            "crypto": "crypto_fit",
            "ai": "ai_fit"
        }
        score += sum(5 for topic in project_topics if topic in track_topics)
        for topic in project_topics:
            fit_key = topic_fit_keys.get(topic)
            if fit_key:
                score += int(track.get(fit_key, 0) or 0)
        if "main_narration" in track_use_cases:
            score += 5
        if "news_commentary" in track_use_cases or "business_commentary" in track_use_cases:
            score += 3
        score += int(track.get("narration_friendliness", 0) or 0)
        if str(track.get("energy") or "").lower() in {"low_medium", "medium"}:
            score += 2
        if "rational" in track_moods or "credible" in track_moods or "clean" in track_moods:
            score += 2
        if "digital" in track_moods or "modern" in track_moods or "forward" in track_moods:
            score += 1
        if "uplifting" in track_moods or "optimistic" in track_moods:
            score -= 1
        if short_form:
            if "main_narration" in track_use_cases:
                score += 3
            if "transition" in track_use_cases or "summary" in track_use_cases:
                score += 1
            if "ambient" in track_moods or "minimal" in track_moods:
                score -= 3
            if "product_demo" in track_use_cases:
                score -= 2
            if "closing" in track_use_cases or "vision_statement" in track_use_cases:
                score -= 2
            if str(track.get("energy") or "").lower() == "medium":
                score += 2
            if "rational" in track_moods or "credible" in track_moods:
                score += 2
        return score

    def _collect_background_music_candidates(self, tracks: List[Dict], project_topics: List[str], target_duration: float) -> List[Dict]:
        candidates = []
        for track in tracks:
            path = self._resolve_music_file(track)
            if path is None:
                continue
            candidates.append({
                "track": track,
                "path": path,
                "score": self._score_music_track(track, project_topics, target_duration),
            })
        candidates.sort(key=lambda item: item["score"], reverse=True)
        return candidates

    def _call_music_llm(self, prompt: str) -> Optional[Dict]:
        if not self.music_llm_enabled:
            return None

        providers = []
        if self.music_llm_provider == "qwen":
            providers = ["qwen"]
        elif self.music_llm_provider == "gemini":
            providers = ["gemini"]
        else:
            providers = ["qwen", "gemini"]

        last_error = None
        text = ""
        for provider in providers:
            try:
                if provider == "qwen":
                    if create_qwen_client is None or qwen_generate_content is None:
                        continue
                    client = create_qwen_client()
                    response = qwen_generate_content(
                        client,
                        model=self.music_llm_model,
                        contents=prompt,
                    )
                    text = (getattr(response, "text", "") or "").strip()
                else:
                    if create_gemini_client is None or gemini_generate_content is None:
                        continue
                    client = create_gemini_client()
                    response = gemini_generate_content(
                        client,
                        model=os.getenv("SMART_CLIP_MUSIC_GEMINI_MODEL", "gemini-2.5-flash"),
                        contents=prompt,
                        response_mime_type="application/json",
                    )
                    text = (getattr(response, "text", "") or "").strip()
                if text:
                    break
            except Exception as e:
                last_error = e
                logger.warning(f"音乐LLM({provider})决策失败: {e}")
                text = ""

        try:
            if not text:
                if last_error is not None:
                    logger.warning(f"音乐LLM不可用，回退规则选曲: {last_error}")
                return None
            match = re.search(r"\{.*\}", text, re.S)
            if not match:
                return None
            return json.loads(match.group(0))
        except Exception as e:
            logger.warning(f"音乐LLM决策失败，回退规则选曲: {e}")
            return None

    def _llm_refine_music_choice(self, candidates: List[Dict], project_topics: List[str], target_duration: float) -> Optional[Dict]:
        if not candidates:
            return None
        shortlist = candidates[:5]
        project_brief = self._extract_project_music_brief()
        candidate_payload = []
        for item in shortlist:
            track = item["track"]
            candidate_payload.append({
                "track_id": track.get("id"),
                "title": track.get("title"),
                "topics": track.get("topics") or [],
                "moods": track.get("moods") or [],
                "use_cases": track.get("use_cases") or [],
                "energy": track.get("energy"),
                "bpm_estimate": track.get("bpm_estimate"),
                "narration_friendliness": track.get("narration_friendliness"),
                "segments": track.get("segments") or {},
                "rule_score": item["score"],
            })

        prompt = (
            MUSIC_SELECTOR_PROMPT.format(
                target_duration=f"{target_duration:.2f}s",
                project_topics_json=json.dumps(project_topics, ensure_ascii=False),
                project_brief=project_brief,
                candidate_tracks_json=json.dumps(candidate_payload, ensure_ascii=False),
            )
            if MUSIC_SELECTOR_PROMPT
            else (
                f"视频时长: {target_duration:.2f}s\n"
                f"主题: {json.dumps(project_topics, ensure_ascii=False)}\n"
                f"项目文本摘要: {project_brief}\n"
                f"候选曲目: {json.dumps(candidate_payload, ensure_ascii=False)}"
            )
        )

        decision = self._call_music_llm(prompt)
        if not isinstance(decision, dict):
            return None
        track_id = str(decision.get("track_id") or "").strip()
        if not track_id:
            return None

        chosen = next((item for item in shortlist if str(item["track"].get("id")) == track_id), None)
        if chosen is None:
            return None

        track_copy = copy.deepcopy(chosen["track"])
        segments = dict(track_copy.get("segments") or {})
        mix_profile = dict(track_copy.get("mix_profile") or {})
        music_duration_hint = float(segments.get("outro_end") or segments.get("bed_end") or 0.0)

        try:
            raw_entry = float(decision.get("short_form_entry_seconds", segments.get("short_form_entry", segments.get("bed_start", 0.0))) or 0.0)
        except Exception:
            raw_entry = float(segments.get("short_form_entry", segments.get("bed_start", 0.0)) or 0.0)

        max_entry = max(0.0, music_duration_hint - 0.2) if music_duration_hint > 0 else max(0.0, target_duration)
        if max_entry <= 0:
            max_entry = max(0.0, raw_entry)
        entry_strategy = str(decision.get("entry_strategy") or "trim_intro")
        bed_start = float(segments.get("bed_start", 0.0) or 0.0)
        intro_end = float(segments.get("intro_end", bed_start) or bed_start)
        entry_point = self._clamp(raw_entry, 0.0, max_entry)
        if entry_strategy == "jump_to_bed":
            aggressive_floor = max(bed_start, intro_end, min(max_entry, bed_start + 0.6))
            entry_point = self._clamp(max(entry_point, aggressive_floor), 0.0, max_entry)
        elif entry_strategy == "trim_intro":
            trim_floor = min(max_entry, max(0.0, intro_end - 0.8))
            entry_point = self._clamp(max(entry_point, trim_floor), 0.0, max_entry)
        segments["short_form_entry"] = round(entry_point, 2)
        segments["entry_strategy"] = entry_strategy

        try:
            gain_adjust = float(decision.get("target_gain_adjust_db", 0.0) or 0.0)
        except Exception:
            gain_adjust = 0.0
        if abs(gain_adjust) > 0.1:
            mix_profile["target_gain_db"] = round(float(mix_profile.get("target_gain_db", -3) or -3) + gain_adjust, 2)

        llm_selection = {
            "provider": "qwen",
            "model": self.music_llm_model,
            "confidence": decision.get("confidence"),
            "reason": decision.get("reason"),
            "entry_strategy": segments.get("entry_strategy"),
            "short_form_entry_seconds": segments.get("short_form_entry"),
            "target_gain_adjust_db": round(gain_adjust, 2),
            "rule_score": chosen["score"],
        }
        track_copy["segments"] = segments
        track_copy["mix_profile"] = mix_profile
        track_copy["llm_selection"] = llm_selection
        return {
            "track": track_copy,
            "path": chosen["path"],
            "score": chosen["score"],
        }

    def _select_background_music(self, target_duration: float = 0.0) -> Tuple[Optional[Dict], Optional[Path], List[str]]:
        index_payload = self._load_music_index()
        tracks = index_payload.get("tracks") or []
        project_topics = self._infer_project_topics()
        if not tracks:
            return None, None, project_topics

        candidates = self._collect_background_music_candidates(tracks, project_topics, target_duration)
        if not candidates:
            return None, None, project_topics

        llm_choice = self._llm_refine_music_choice(candidates, project_topics, target_duration)
        if llm_choice is not None:
            return llm_choice["track"], llm_choice["path"], project_topics

        return candidates[0]["track"], candidates[0]["path"], project_topics

    def _audio_fadein_compat(self, audio_clip, duration: float):
        if duration <= 0 or audio_clip is None:
            return audio_clip
        if hasattr(audio_clip, "audio_fadein"):
            return audio_clip.audio_fadein(duration)
        try:
            from moviepy.audio.fx.AudioFadeIn import AudioFadeIn
            return audio_clip.with_effects([AudioFadeIn(duration)])
        except Exception:
            return audio_clip

    def _audio_fadeout_compat(self, audio_clip, duration: float):
        if duration <= 0 or audio_clip is None:
            return audio_clip
        if hasattr(audio_clip, "audio_fadeout"):
            return audio_clip.audio_fadeout(duration)
        try:
            from moviepy.audio.fx.AudioFadeOut import AudioFadeOut
            return audio_clip.with_effects([AudioFadeOut(duration)])
        except Exception:
            return audio_clip

    def _build_background_music_clip(self, music_path: Path, track_meta: Dict, target_duration: float):
        music_clip = None
        try:
            if target_duration <= 0:
                return None, None

            music_clip = AudioFileClip(str(music_path))
            music_duration = float(getattr(music_clip, "duration", 0.0) or 0.0)
            if music_duration <= 0:
                return None, None

            segments = track_meta.get("segments") or {}
            intro_start = float(segments.get("intro_start", 0.0) or 0.0)
            intro_end = min(music_duration, float(segments.get("intro_end", min(music_duration, intro_start + 6.0)) or 0.0))
            bed_start = min(music_duration, float(segments.get("bed_start", intro_end) or intro_end))
            bed_end = min(music_duration, float(segments.get("bed_end", max(bed_start + 8.0, music_duration)) or music_duration))
            outro_start = min(music_duration, float(segments.get("outro_start", max(bed_start, music_duration - 8.0)) or 0.0))
            outro_end = min(music_duration, float(segments.get("outro_end", music_duration) or music_duration))

            intro_len = max(0.0, intro_end - intro_start)
            bed_len = max(0.0, bed_end - bed_start)
            outro_len = max(0.0, outro_end - outro_start)

            parts = []
            remaining = target_duration

            short_form_entry = segments.get("short_form_entry")
            entry_point = None
            if short_form_entry is not None:
                try:
                    entry_point = min(max(0.0, float(short_form_entry)), max(0.0, music_duration - 0.2))
                except Exception:
                    entry_point = None
            if entry_point is None and bed_len > 0:
                # 默认直接切到主节奏区域，不再保留长前奏。
                entry_point = min(max(0.0, bed_start + 0.8), max(0.0, music_duration - 0.2))
            if entry_point is not None:
                intro_start = entry_point
                intro_end = entry_point
                intro_len = 0.0
                bed_start = max(bed_start, entry_point)
                bed_len = max(0.0, bed_end - bed_start)
            if target_duration <= 30:
                outro_len = min(outro_len, 2.0)

            if intro_len > 0:
                take = min(intro_len, remaining)
                parts.append(self._subclip_compat(music_clip, intro_start, intro_start + take))
                remaining -= take

            outro_reserved = min(max(0.0, target_duration * 0.12), outro_len, max(0.0, remaining))
            body_target = max(0.0, remaining - outro_reserved)

            if body_target > 0:
                if bed_len <= 0:
                    filler_end = min(music_duration, max(intro_start + body_target, body_target))
                    parts.append(self._subclip_compat(music_clip, 0, filler_end))
                else:
                    loops = max(1, int(math.ceil(body_target / bed_len)))
                    for _ in range(loops):
                        parts.append(self._subclip_compat(music_clip, bed_start, bed_end))
                    body_audio = concatenate_audioclips(parts[-loops:])
                    parts = parts[:-loops] + [self._subclip_compat(body_audio, 0, body_target)]

            if outro_reserved > 0:
                parts.append(self._subclip_compat(music_clip, max(outro_start, outro_end - outro_reserved), outro_end))

            if not parts:
                parts = [self._subclip_compat(music_clip, 0, min(target_duration, music_duration))]

            bgm_audio = concatenate_audioclips(parts) if len(parts) > 1 else parts[0]
            bgm_audio = self._subclip_compat(bgm_audio, 0, min(target_duration, float(getattr(bgm_audio, "duration", target_duration) or target_duration)))
            fadein_duration = min(0.12, target_duration / 10) if target_duration <= 30 else min(0.8, target_duration / 4)
            bgm_audio = self._audio_fadein_compat(bgm_audio, fadein_duration)
            bgm_audio = self._audio_fadeout_compat(bgm_audio, min(1.2, target_duration / 4))

            target_gain_db = float(((track_meta.get("mix_profile") or {}).get("target_gain_db")) or -21)
            bgm_audio = self._volume_audio_compat(bgm_audio, 10 ** (target_gain_db / 20))
            return bgm_audio, music_clip
        except Exception as e:
            logger.warning(f"构建背景音乐失败: {e}")
            if music_clip is not None:
                try:
                    music_clip.close()
                except Exception:
                    pass
            return None, None

    def _save_selected_music(self, track_meta: Dict, music_path: Path, project_topics: List[str]):
        try:
            payload = {
                "track_id": track_meta.get("id"),
                "title": track_meta.get("title"),
                "provider": track_meta.get("provider"),
                "source_url": track_meta.get("source_url"),
                "music_file": str(music_path),
                "topics": project_topics,
                "mix_profile": track_meta.get("mix_profile") or {},
                "segments": track_meta.get("segments") or {},
                "llm_selection": track_meta.get("llm_selection") or {}
            }
            (self.work_dir / "selected_bgm.json").write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )
        except Exception as e:
            logger.warning(f"写入 selected_bgm.json 失败: {e}")

    def _clear_selected_music(self):
        try:
            target = self.work_dir / "selected_bgm.json"
            if target.exists():
                target.unlink()
        except Exception as e:
            logger.warning(f"清理 selected_bgm.json 失败: {e}")

    def _analyze_clip_loudness(self, audio_clip, temp_name: str) -> Optional[float]:
        if audio_clip is None:
            return None
        temp_audio = self.work_dir / temp_name
        try:
            audio_clip.write_audiofile(str(temp_audio), logger=None)
            return float(self.audio_processor.analyze_loudness(str(temp_audio)))
        except Exception as e:
            logger.warning(f"分析音频响度失败 {temp_name}: {e}")
            return None
        finally:
            try:
                if temp_audio.exists():
                    temp_audio.unlink()
            except Exception:
                pass

    def _build_priority_audio_mix(self, main_audio, bgm_audio):
        if main_audio is None or bgm_audio is None:
            return main_audio, bgm_audio

        main_audio = self._volume_audio_compat(main_audio, 10 ** (self.voice_priority_boost_db / 20))
        bgm_audio = self._volume_audio_compat(bgm_audio, 10 ** (self.bgm_global_boost_db / 20))

        main_loudness = self._analyze_clip_loudness(main_audio, "_mix_main_analysis.wav")
        if main_loudness is not None:
            voice_boost_db = min(
                max(0.0, self.voice_target_lufs - main_loudness),
                max(0.0, self.voice_max_boost_db)
            )
            if voice_boost_db > 0.5:
                logger.info(
                    f"提升主口播响度: main={main_loudness:.1f} LUFS, "
                    f"target={self.voice_target_lufs:.1f} LUFS, boost={voice_boost_db:.1f} dB"
                )
                main_audio = self._volume_audio_compat(main_audio, 10 ** (voice_boost_db / 20))
                main_loudness += voice_boost_db

        bgm_loudness = self._analyze_clip_loudness(bgm_audio, "_mix_bgm_analysis.wav")

        if main_loudness is not None and bgm_loudness is not None:
            target_bgm_loudness = self._clamp(
                main_loudness - self.voice_bgm_gap_db,
                self.bgm_min_lufs,
                self.bgm_max_lufs
            )
            adjustment_db = target_bgm_loudness - bgm_loudness
            if abs(adjustment_db) > 0.5:
                logger.info(
                    f"自适应BGM响度: main={main_loudness:.1f} LUFS, "
                    f"bgm={bgm_loudness:.1f} LUFS, target={target_bgm_loudness:.1f} LUFS, "
                    f"adjust={adjustment_db:.1f} dB"
                )
                bgm_audio = self._volume_audio_compat(bgm_audio, 10 ** (adjustment_db / 20))

        return main_audio, bgm_audio

    def compose_from_director_plan(
        self,
        director_plan_path: str,
        material_video: str,
        aiman_video: str,
        output_path: str,
        use_smart_clip: bool = True
    ) -> bool:
        """
        根据导演方案合成最终视频

        Args:
            director_plan_path: 导演方案JSON路径
            material_video: 素材视频路径
            aiman_video: 数字人视频路径
            output_path: 输出视频路径
            use_smart_clip: 是否使用智能剪辑

        Returns:
            是否成功
        """
        try:
            # 1. 加载导演方案
            with open(director_plan_path, 'r', encoding='utf-8') as f:
                plan = json.load(f)

            if isinstance(plan, dict):
                raw_segments = plan.get('segments', [])
            elif isinstance(plan, list):
                raw_segments = plan
            else:
                raw_segments = []

            # 兼容两种导演方案格式：
            # 1) 新格式: {"segments":[{"type","start","end","duration","ost"...}]}
            # 2) 现格式: [{"video_source","start_time","end_time","cut_start","cut_end"...}]
            segments = []
            for item in raw_segments:
                if not isinstance(item, dict):
                    continue
                seg_type = item.get('type')
                if not seg_type:
                    video_source = str(item.get('video_source', '')).lower()
                    seg_type = 'aiman' if 'aiman' in video_source else 'material'

                start = float(item.get('start', item.get('cut_start', item.get('start_time', 0.0))) or 0.0)
                end = float(item.get('end', item.get('cut_end', item.get('end_time', start))) or start)
                duration = float(item.get('duration', max(0.0, end - start)) or 0.0)
                tts_duration = float(item.get('tts_duration', duration) or duration)
                ost = int(item.get('ost', 1 if item.get('audio_source') == 'main' else 0))

                segments.append({
                    **item,
                    'type': seg_type,
                    'start': start,
                    'end': end,
                    'duration': duration,
                    'tts_duration': tts_duration,
                    'ost': ost
                })

            logger.info(f"加载导演方案: {len(segments)} 个片段")

            # 2. 准备临时目录
            temp_dir = self.work_dir / "temp_clips"
            temp_dir.mkdir(exist_ok=True)

            # 3. 根据OST策略剪辑片段
            clip_paths = []
            required_clip_paths = set()
            for i, segment in enumerate(segments):
                clip_path = temp_dir / f"clip_{i:03d}.mp4"
                is_required_cutaway = segment.get('type') == 'material_cutaway'
                if is_required_cutaway:
                    required_clip_paths.add(str(clip_path))

                if use_smart_clip:
                    success = self._clip_segment_with_ost(
                        segment, material_video, aiman_video, clip_path
                    )
                else:
                    success = self._clip_segment_basic(
                        segment, material_video, aiman_video, clip_path
                    )

                if success:
                    clip_paths.append(str(clip_path))
                else:
                    if is_required_cutaway:
                        logger.error(f"必需素材插片 {i} 剪辑失败，停止渲染以避免输出缺失插片的成片")
                        return False
                    logger.warning(f"片段 {i} 剪辑失败，跳过")

            if not clip_paths:
                logger.error("没有成功剪辑的片段")
                return False

            # 4. 使用MoviePy合成最终视频
            logger.info(f"开始合成 {len(clip_paths)} 个片段")
            success = self._compose_with_moviepy(clip_paths, output_path, required_clip_paths=required_clip_paths)

            # 5. 清理临时文件
            if success:
                logger.info("清理临时文件")
                for clip_path in clip_paths:
                    try:
                        os.remove(clip_path)
                    except:
                        pass

            return success

        except Exception as e:
            logger.error(f"合成失败: {e}", exc_info=True)
            return False

    def _clip_segment_with_ost(
        self,
        segment: Dict,
        material_video: str,
        aiman_video: str,
        output_path: Path
    ) -> bool:
        """
        根据 execution_plan 剪辑片段。

        当前只保留两类主语义:
        - type="aiman": 数字人视频 + 数字人口播
        - type="material_cutaway": 原素材静音插片 + 数字人口播
        """
        try:
            seg_type = segment.get('type')

            if seg_type == 'aiman':
                return self._clip_aiman_segment(segment, aiman_video, output_path)

            elif seg_type == 'material_cutaway':
                return self._clip_material_cutaway(
                    segment, material_video, aiman_video, output_path
                )

            logger.warning(f"未知片段类型: {seg_type}")
            return False

        except Exception as e:
            logger.error(f"剪辑片段失败: {e}", exc_info=True)
            return False

    def _subclip_compat(self, clip, start: float, end: float):
        if hasattr(clip, "subclipped"):
            return clip.subclipped(start, end)
        return clip.subclip(start, end)

    def _resize_compat(self, clip, width: int = None, height: int = None):
        if hasattr(clip, "resized"):
            return clip.resized(width=width, height=height)
        return clip.resize(width=width, height=height)

    def _position_compat(self, clip, position):
        if hasattr(clip, "with_position"):
            return clip.with_position(position)
        return clip.set_position(position)

    def _without_audio_compat(self, clip):
        if hasattr(clip, "without_audio"):
            return clip.without_audio()
        return clip.without_audio()

    def _set_duration_compat(self, clip, duration: float):
        if hasattr(clip, "with_duration"):
            return clip.with_duration(duration)
        return clip.set_duration(duration)

    def _crop_compat(self, clip, x_center: float, y_center: float, width: int, height: int):
        if hasattr(clip, "cropped"):
            return clip.cropped(x_center=x_center, y_center=y_center, width=width, height=height)
        return clip.crop(x_center=x_center, y_center=y_center, width=width, height=height)

    def _set_audio_compat(self, clip, audio):
        if hasattr(clip, "with_audio"):
            return clip.with_audio(audio)
        return clip.set_audio(audio)

    def _fadein_compat(self, clip, duration: float):
        if duration <= 0:
            return clip
        if hasattr(clip, "fadein"):
            return clip.fadein(duration)
        return clip

    def _fadeout_compat(self, clip, duration: float):
        if duration <= 0:
            return clip
        if hasattr(clip, "fadeout"):
            return clip.fadeout(duration)
        return clip

    def _round_even_dimension(self, value: float) -> int:
        return max(2, int(value) // 2 * 2)

    def _inscribe_landscape_canvas(self, max_width: int, max_height: int) -> Tuple[int, int]:
        aspect_ratio = 4 / 3
        width_by_height = int(math.floor(float(max_height) * aspect_ratio))

        if width_by_height <= int(max_width):
            target_width = width_by_height
            target_height = int(max_height)
        else:
            target_width = int(max_width)
            target_height = int(math.floor(float(max_width) / aspect_ratio))

        return (
            self._round_even_dimension(target_width),
            self._round_even_dimension(target_height),
        )

    def _cover_clip_to_canvas(self, clip, width: int, height: int):
        clip_width = int(getattr(clip, "w", 0) or 0)
        clip_height = int(getattr(clip, "h", 0) or 0)
        if clip_width <= 0 or clip_height <= 0:
            return clip

        scale = max(width / clip_width, height / clip_height)
        resized_width = max(1, int(round(clip_width * scale)))
        resized_height = max(1, int(round(clip_height * scale)))
        fitted = self._resize_compat(clip, width=resized_width, height=resized_height)
        return self._crop_compat(
            fitted,
            x_center=resized_width / 2,
            y_center=resized_height / 2,
            width=width,
            height=height
        )

    def _contain_clip_on_canvas(self, clip, width: int, height: int):
        clip_width = int(getattr(clip, "w", 0) or 0)
        clip_height = int(getattr(clip, "h", 0) or 0)
        if clip_width <= 0 or clip_height <= 0:
            return clip

        scale = min(width / clip_width, height / clip_height)
        resized_width = max(1, int(round(clip_width * scale)))
        resized_height = max(1, int(round(clip_height * scale)))
        foreground = self._resize_compat(clip, width=resized_width, height=resized_height)
        background = self._set_duration_compat(
            ColorClip(size=(width, height), color=(8, 12, 20)),
            float(getattr(clip, "duration", 0.0) or 0.0)
        )
        return CompositeVideoClip(
            [background, self._position_compat(foreground, ("center", "center"))],
            size=(width, height)
        )

    def _fit_clip_to_canvas(self, clip, width: int, height: int):
        clip_width = int(getattr(clip, "w", 0) or 0)
        clip_height = int(getattr(clip, "h", 0) or 0)
        if clip_width <= 0 or clip_height <= 0:
            return clip

        if width >= height and clip_width < clip_height:
            return self._contain_clip_on_canvas(clip, width, height)

        return self._cover_clip_to_canvas(clip, width, height)

    def _resolve_canvas_size(self, clips: List):
        if self.target_width > 0 and self.target_height > 0:
            return self.target_width, self.target_height

        dimensions = []
        for clip in clips:
            clip_width = int(getattr(clip, "w", 0) or 0)
            clip_height = int(getattr(clip, "h", 0) or 0)
            if clip_width > 0 and clip_height > 0:
                dimensions.append((clip_width, clip_height))

        if not dimensions:
            return 1280, 720

        landscape_dimensions = [(width, height) for width, height in dimensions if width >= height]
        candidate_dimensions = landscape_dimensions or dimensions

        # 始终收敛到横版 4:3，优先使用最小可行源尺寸，避免把低分辨率素材无谓放大。
        base_width, base_height = min(
            candidate_dimensions,
            key=lambda item: (item[0] * item[1], item[0] + item[1])
        )

        return self._inscribe_landscape_canvas(base_width, base_height)

    def _volume_audio_compat(self, audio_clip, factor: float):
        try:
            from moviepy.audio.fx.all import volumex
            return audio_clip.fx(volumex, factor)
        except Exception:
            from moviepy.audio.fx.MultiplyVolume import MultiplyVolume
            return audio_clip.with_effects([MultiplyVolume(factor)])

    def _clip_material_cutaway(
        self,
        segment: Dict,
        material_video: str,
        aiman_video: str,
        output_path: Path
    ) -> bool:
        """原素材静音插片，音轨完全跟随数字人口播。"""
        material_clip = None
        avatar_clip = None
        final_clip = None
        try:
            material_start = float(segment.get("start", 0.0) or 0.0)
            material_end = float(segment.get("end", material_start) or material_start)
            avatar_start = float(segment.get("avatar_cut_start", 0.0) or 0.0)
            avatar_end = float(segment.get("avatar_cut_end", avatar_start) or avatar_start)
            duration = max(0.3, float(segment.get("duration", material_end - material_start) or 0.0))

            material_duration = self._get_video_duration(material_video)
            avatar_duration = self._get_video_duration(aiman_video)
            if material_duration > 0:
                material_start = min(material_start, max(0.0, material_duration - duration))
                material_end = min(material_duration, material_start + duration)
            if avatar_duration > 0:
                avatar_start = min(avatar_start, max(0.0, avatar_duration - duration))
                avatar_end = min(avatar_duration, max(avatar_start + 0.1, avatar_start + duration))

            material_clip = self._subclip_compat(VideoFileClip(material_video), material_start, material_end)
            material_clip = self._without_audio_compat(material_clip)
            avatar_clip = self._subclip_compat(VideoFileClip(aiman_video), avatar_start, avatar_end)
            avatar_audio = getattr(avatar_clip, "audio", None)
            final_clip = material_clip
            final_audio = avatar_audio

            if final_audio is not None:
                final_clip = self._set_audio_compat(final_clip, final_audio)
            else:
                final_clip = self._without_audio_compat(final_clip)

            final_clip.write_videofile(
                str(output_path),
                codec="libx264",
                audio_codec="aac",
                temp_audiofile=str(self.work_dir / f"{output_path.stem}.m4a"),
                remove_temp=True,
                fps=30,
                preset="medium",
                logger=None,
            )
            logger.info(f"静音素材插片剪辑成功: {output_path.name}")
            return True
        except Exception as e:
            logger.error(f"静音素材插片失败: {e}", exc_info=True)
            return False
        finally:
            for clip in [final_clip, material_clip, avatar_clip]:
                try:
                    if clip is not None:
                        clip.close()
                except Exception:
                    pass

    def _clip_aiman_segment(
        self,
        segment: Dict,
        aiman_video: str,
        output_path: Path
    ) -> bool:
        """剪辑数字人片段"""
        try:
            start = segment.get('start', 0)
            duration = segment.get('duration', 0)
            end = segment.get('end')

            if duration <= 0:
                logger.warning("数字人片段时长无效")
                return False

            if end is not None:
                try:
                    bounded_duration = max(0.0, float(end) - float(start))
                    if bounded_duration > 0:
                        duration = min(float(duration), bounded_duration)
                except Exception:
                    pass

            # 防止导演方案时间超过数字人素材时长，自动纠正到可用区间
            video_duration = self._get_video_duration(aiman_video)
            if video_duration > 0:
                max_start = max(0.0, video_duration - duration)
                if start > max_start:
                    logger.warning(
                        f"数字人片段起点超出素材时长，自动纠正: start={start:.2f}s -> {max_start:.2f}s"
                    )
                    start = max_start
                duration = min(duration, max(0.1, video_duration - start))

            # 使用硬件加速剪辑
            cmd = [
                'ffmpeg', '-y',
                '-ss', str(start),
                '-t', str(duration),
                '-i', aiman_video
            ]

            # 添加编码器配置
            encoder_config = self.clip_engine.get_encoder_config()
            cmd.extend(encoder_config)

            cmd.extend([
                '-c:a', 'aac',
                '-b:a', '192k',
                '-af', 'aresample=async=1:first_pts=0',
                '-shortest',
                '-avoid_negative_ts', 'make_zero',
                str(output_path)
            ])

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300
            )

            if result.returncode == 0:
                logger.info(f"数字人片段剪辑成功: {output_path.name}")
                return True
            else:
                logger.warning("数字人片段硬件剪辑失败，尝试软件编码回退")
                ok = self._clip_with_software_fallback(
                    aiman_video, start, duration, output_path, remove_audio=False
                )
                if not ok:
                    logger.error(f"数字人片段剪辑失败: {result.stderr}")
                return ok

        except Exception as e:
            logger.error(f"剪辑数字人片段异常: {e}", exc_info=True)
            return False

    def _clip_material_narration_only(
        self,
        segment: Dict,
        material_video: str,
        output_path: Path
    ) -> bool:
        """
        OST=0: 纯解说片段
        - 移除原声
        - 按TTS时长剪辑
        """
        try:
            start = segment.get('start', 0)
            tts_duration = segment.get('tts_duration', 0)

            if tts_duration <= 0:
                logger.warning("TTS时长无效")
                return False

            # 剪辑视频并移除音频
            cmd = [
                'ffmpeg', '-y',
                '-ss', str(start),
                '-t', str(tts_duration),
                '-i', material_video,
                '-an'  # 移除音频
            ]

            encoder_config = self.clip_engine.get_encoder_config()
            cmd.extend(encoder_config)

            cmd.extend([
                '-avoid_negative_ts', 'make_zero',
                str(output_path)
            ])

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300
            )

            if result.returncode == 0:
                logger.info(f"纯解说片段剪辑成功: {output_path.name}")
                return True
            else:
                logger.error(f"纯解说片段剪辑失败: {result.stderr}")
                # Fallback: 使用软件编码
                return self._clip_with_software_fallback(
                    material_video, start, tts_duration, output_path, remove_audio=True
                )

        except Exception as e:
            logger.error(f"剪辑纯解说片段异常: {e}", exc_info=True)
            return False

    def _clip_material_original_audio(
        self,
        segment: Dict,
        material_video: str,
        output_path: Path
    ) -> bool:
        """
        OST=1: 纯原声片段
        - 保留原声
        - 按时间戳剪辑
        """
        try:
            start = segment.get('start', 0)
            end = segment.get('end', 0)
            duration = end - start

            if duration <= 0:
                logger.warning("片段时长无效")
                return False

            # 剪辑视频并保留音频
            cmd = [
                'ffmpeg', '-y',
                '-ss', str(start),
                '-t', str(duration),
                '-i', material_video
            ]

            encoder_config = self.clip_engine.get_encoder_config()
            cmd.extend(encoder_config)

            cmd.extend([
                '-c:a', 'aac',
                '-b:a', '192k',
                '-avoid_negative_ts', 'make_zero',
                str(output_path)
            ])

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300
            )

            if result.returncode == 0:
                logger.info(f"纯原声片段剪辑成功: {output_path.name}")
                return True
            else:
                logger.warning("纯原声片段硬件剪辑失败，尝试软件编码回退")
                return self._clip_with_software_fallback(
                    material_video, start, duration, output_path, remove_audio=False
                )

        except Exception as e:
            logger.error(f"剪辑纯原声片段异常: {e}", exc_info=True)
            return False

    def _clip_material_mixed(
        self,
        segment: Dict,
        material_video: str,
        output_path: Path
    ) -> bool:
        """
        OST=2: 混合片段
        - 保留原声（后续会混合解说）
        - 按TTS时长剪辑
        """
        try:
            start = segment.get('start', 0)
            tts_duration = segment.get('tts_duration', 0)

            if tts_duration <= 0:
                logger.warning("TTS时长无效")
                return False

            # 剪辑视频并保留音频
            cmd = [
                'ffmpeg', '-y',
                '-ss', str(start),
                '-t', str(tts_duration),
                '-i', material_video
            ]

            encoder_config = self.clip_engine.get_encoder_config()
            cmd.extend(encoder_config)

            cmd.extend([
                '-c:a', 'aac',
                '-b:a', '192k',
                '-avoid_negative_ts', 'make_zero',
                str(output_path)
            ])

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300
            )

            if result.returncode == 0:
                logger.info(f"混合片段剪辑成功: {output_path.name}")
                return True
            else:
                logger.warning("混合片段硬件剪辑失败，尝试软件编码回退")
                return self._clip_with_software_fallback(
                    material_video, start, tts_duration, output_path, remove_audio=False
                )

        except Exception as e:
            logger.error(f"剪辑混合片段异常: {e}", exc_info=True)
            return False

    def _clip_with_software_fallback(
        self,
        video_path: str,
        start: float,
        duration: float,
        output_path: Path,
        remove_audio: bool = False
    ) -> bool:
        """软件编码Fallback"""
        try:
            logger.info("使用软件编码Fallback")

            cmd = [
                'ffmpeg', '-y',
                '-ss', str(start),
                '-t', str(duration),
                '-i', video_path,
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '23'
            ]

            if remove_audio:
                cmd.append('-an')
            else:
                cmd.extend([
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-af', 'aresample=async=1:first_pts=0',
                    '-shortest'
                ])

            cmd.extend([
                '-avoid_negative_ts', 'make_zero',
                str(output_path)
            ])

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300
            )

            return result.returncode == 0

        except Exception as e:
            logger.error(f"软件编码Fallback失败: {e}", exc_info=True)
            return False

    def _get_video_duration(self, video_path: str) -> float:
        """通过 ffprobe 获取视频时长（秒）。"""
        try:
            cmd = [
                'ffprobe',
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                video_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if result.returncode != 0:
                return 0.0
            return float((result.stdout or '').strip() or 0.0)
        except Exception:
            return 0.0

    def _clip_segment_basic(
        self,
        segment: Dict,
        material_video: str,
        aiman_video: str,
        output_path: Path
    ) -> bool:
        """基础剪辑（不使用智能剪辑）"""
        try:
            seg_type = segment.get('type')
            start = segment.get('start', 0)
            duration = segment.get('duration', 0)

            if duration <= 0:
                return False

            source_video = aiman_video if seg_type == 'aiman' else material_video

            cmd = [
                'ffmpeg', '-y',
                '-ss', str(start),
                '-t', str(duration),
                '-i', source_video,
                '-c', 'copy',
                str(output_path)
            ]

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300
            )

            return result.returncode == 0

        except Exception as e:
            logger.error(f"基础剪辑失败: {e}", exc_info=True)
            return False

    def _compose_with_moviepy(
        self,
        clip_paths: List[str],
        output_path: str,
        required_clip_paths: Optional[set] = None
    ) -> bool:
        """
        使用MoviePy合成最终视频
        集成NarratoAI的merge_materials逻辑
        """
        try:
            logger.info("使用MoviePy合成视频")
            audio_resources_to_close = []

            # 1. 加载所有片段
            clips = []
            required_clip_paths = set(required_clip_paths or [])
            for clip_path in clip_paths:
                try:
                    clip = VideoFileClip(clip_path)
                    clips.append(clip)
                except Exception as e:
                    if clip_path in required_clip_paths:
                        logger.error(f"必需素材插片加载失败 {clip_path}: {e}")
                        return False
                    logger.warning(f"加载片段失败 {clip_path}: {e}")

            if not clips:
                logger.error("没有可用的视频片段")
                return False

            canvas_width, canvas_height = self._resolve_canvas_size(clips)
            logger.info(f"统一输出画布: {canvas_width}x{canvas_height}")
            normalized_clips = []
            sequential_audio_tracks = []
            for index, clip in enumerate(clips):
                original_audio = clip.audio
                normalized = self._fit_clip_to_canvas(clip, canvas_width, canvas_height)
                safe_transition = min(
                    self.transition_seconds,
                    self.crossfade_seconds,
                    max(0.0, float(getattr(normalized, "duration", 0.0) or 0.0) / 2 - 0.02)
                )
                if index > 0:
                    normalized = self._fadein_compat(normalized, safe_transition)
                if index < len(clips) - 1:
                    normalized = self._fadeout_compat(normalized, safe_transition)
                if original_audio is not None:
                    clip_duration = max(0.0, float(getattr(clip, "duration", 0.0) or 0.0))
                    if clip_duration > 0:
                        try:
                            original_audio = self._subclip_compat(original_audio, 0, clip_duration)
                        except Exception:
                            pass
                    sequential_audio_tracks.append(original_audio)
                    normalized = self._without_audio_compat(normalized)
                normalized_clips.append(normalized)
            clips = normalized_clips

            # 2. 拼接视频
            logger.info(f"拼接 {len(clips)} 个片段")
            if len(clips) > 1 and self.crossfade_seconds > 0 and not sequential_audio_tracks:
                try:
                    # 仅在音频也允许重叠的场景下启用，避免口型和口播发生系统性漂移
                    final_video = concatenate_videoclips(
                        clips,
                        method="compose",
                        padding=-self.crossfade_seconds
                    )
                except TypeError:
                    # 兼容部分 MoviePy 版本可能不支持 padding 参数
                    final_video = concatenate_videoclips(clips, method="compose")
            else:
                final_video = concatenate_videoclips(clips, method="compose")

            # 3. 音频按原时间线顺序拼接，避免转场阶段把相邻口播叠在一起
            if sequential_audio_tracks:
                try:
                    final_audio = concatenate_audioclips(sequential_audio_tracks)
                    final_video = self._set_audio_compat(final_video, final_audio)
                except Exception as e:
                    logger.warning(f"顺序音频拼接失败，回退到视频自带音轨: {e}")

            # 4. 音频响度统一
            if final_video.audio is not None:
                if self.auto_bgm_enabled:
                    track_meta, music_path, project_topics = self._select_background_music(
                        float(getattr(final_video, "duration", 0.0) or 0.0)
                    )
                    if track_meta is not None and music_path is not None:
                        bgm_audio, bgm_owner = self._build_background_music_clip(
                            music_path,
                            track_meta,
                            float(getattr(final_video, "duration", 0.0) or 0.0)
                        )
                        if bgm_audio is not None:
                            main_audio = final_video.audio
                            if main_audio is not None:
                                main_audio, bgm_audio = self._build_priority_audio_mix(main_audio, bgm_audio)
                            final_audio = CompositeAudioClip([bgm_audio, main_audio])
                            final_video = self._set_audio_compat(final_video, final_audio)
                            self._save_selected_music(track_meta, music_path, project_topics)
                            logger.info(f"已自动选中配乐: {track_meta.get('title')} -> {music_path.name}")
                            if bgm_owner is not None:
                                audio_resources_to_close.append(bgm_owner)
                    else:
                        self._clear_selected_music()
                else:
                    self._clear_selected_music()
                logger.info("统一音频响度")
                final_video = self._normalize_audio(final_video)

            # 5. 导出最终视频
            logger.info(f"导出最终视频: {output_path}")
            final_video.write_videofile(
                output_path,
                codec='libx264',
                audio_codec='aac',
                temp_audiofile='temp-audio.m4a',
                remove_temp=True,
                fps=30,
                preset='medium',
                threads=4
            )

            # 6. 清理
            for clip in clips:
                clip.close()
            for audio_resource in audio_resources_to_close:
                try:
                    audio_resource.close()
                except Exception:
                    pass
            final_video.close()

            logger.info("视频合成完成")
            return True

        except Exception as e:
            logger.error(f"MoviePy合成失败: {e}", exc_info=True)
            # Fallback: 使用FFmpeg concat
            return self._compose_with_ffmpeg_concat(clip_paths, output_path)

    def _normalize_audio(self, video_clip):
        """统一音频响度到-16 LUFS"""
        try:
            # 分析音频响度
            temp_audio = "temp_audio_analysis.wav"
            video_clip.audio.write_audiofile(temp_audio, logger=None)

            loudness = self.audio_processor.analyze_loudness(temp_audio)
            target_loudness = -16.0
            adjustment = target_loudness - loudness

            # 调整音量
            if abs(adjustment) > 0.5:
                logger.info(f"调整音量: {adjustment:.1f} dB")
                factor = 10 ** (adjustment / 20)
                # MoviePy 1.x: audio.fx(volumex, factor) + set_audio
                # MoviePy 2.x: with_effects([MultiplyVolume]) + with_audio
                try:
                    from moviepy.audio.fx.all import volumex  # 1.x
                    adjusted_audio = video_clip.audio.fx(volumex, factor)
                except Exception:
                    from moviepy.audio.fx.MultiplyVolume import MultiplyVolume  # 2.x
                    adjusted_audio = video_clip.audio.with_effects([MultiplyVolume(factor)])

                if hasattr(video_clip, 'set_audio'):
                    video_clip = video_clip.set_audio(adjusted_audio)
                else:
                    video_clip = video_clip.with_audio(adjusted_audio)

            # 清理临时文件
            if os.path.exists(temp_audio):
                os.remove(temp_audio)

            return video_clip

        except Exception as e:
            logger.warning(f"音频响度统一失败: {e}")
            return video_clip

    def _compose_with_ffmpeg_concat(
        self,
        clip_paths: List[str],
        output_path: str
    ) -> bool:
        """FFmpeg concat Fallback"""
        try:
            logger.info("使用FFmpeg concat Fallback")

            # 创建concat文件
            concat_file = self.work_dir / "concat_list.txt"
            with open(concat_file, 'w', encoding='utf-8') as f:
                for clip_path in clip_paths:
                    f.write(f"file '{clip_path}'\n")

            # 执行concat
            cmd = [
                'ffmpeg', '-y',
                '-f', 'concat',
                '-safe', '0',
                '-i', str(concat_file),
                '-c', 'copy',
                output_path
            ]

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600
            )

            # 清理
            if concat_file.exists():
                concat_file.unlink()

            return result.returncode == 0

        except Exception as e:
            logger.error(f"FFmpeg concat失败: {e}", exc_info=True)
            return False
