#!/usr/bin/env python3
"""
智能音频处理模块 - 从 NarratoAI 移植
提供音量分析、智能平衡、音频归一化等功能
"""
import sys

def _setup_utf8_stdio():
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

_setup_utf8_stdio()

import os
import subprocess
import json
import tempfile
from typing import Dict, Tuple, Optional


class AudioProcessor:
    """音频处理器"""

    # 音量默认配置
    DEFAULT_VOICE_VOLUME = 1.0
    DEFAULT_ORIGINAL_VOLUME = 1.2  # 提高原声以平衡TTS
    DEFAULT_BGM_VOLUME = 0.3
    MIN_VOLUME = 0.0
    MAX_VOLUME = 2.0

    def __init__(self):
        self.enable_smart_volume = True

    def analyze_audio_loudness(self, audio_path: str) -> float:
        """
        分析音频响度

        Args:
            audio_path: 音频文件路径

        Returns:
            响度值(LUFS)
        """
        try:
            cmd = [
                'ffmpeg', '-i', audio_path,
                '-af', 'loudnorm=print_format=json',
                '-f', 'null', '-'
            ]

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60
            )

            # 从stderr中提取JSON
            output = result.stderr
            json_start = output.rfind('{')
            json_end = output.rfind('}') + 1

            if json_start >= 0 and json_end > json_start:
                loudness_data = json.loads(output[json_start:json_end])
                return float(loudness_data.get('input_i', -23.0))

        except Exception as e:
            print(f"   ⚠️ 音频响度分析失败: {e}")

        return -23.0  # 默认响度

    # 兼容调用别名
    def analyze_loudness(self, audio_path: str) -> float:
        return self.analyze_audio_loudness(audio_path)

    def calculate_volume_adjustment(
        self,
        tts_audio_path: str,
        original_audio_path: str,
        target_loudness: float = -16.0
    ) -> Tuple[float, float]:
        """
        计算智能音量调整系数

        Args:
            tts_audio_path: TTS音频路径
            original_audio_path: 原声音频路径
            target_loudness: 目标响度

        Returns:
            (TTS调整系数, 原声调整系数)
        """
        if not self.enable_smart_volume:
            return 1.0, 1.0

        try:
            tts_loudness = self.analyze_audio_loudness(tts_audio_path)
            original_loudness = self.analyze_audio_loudness(original_audio_path)

            # 计算调整系数
            tts_adjustment = 10 ** ((target_loudness - tts_loudness) / 20)
            original_adjustment = 10 ** ((target_loudness - original_loudness) / 20)

            # 限制范围
            tts_adjustment = max(0.5, min(1.5, tts_adjustment))
            original_adjustment = max(0.5, min(2.0, original_adjustment))

            print(f"   📊 智能音量分析:")
            print(f"      TTS响度: {tts_loudness:.1f} LUFS → 调整系数: {tts_adjustment:.2f}")
            print(f"      原声响度: {original_loudness:.1f} LUFS → 调整系数: {original_adjustment:.2f}")

            return tts_adjustment, original_adjustment

        except Exception as e:
            print(f"   ⚠️ 智能音量计算失败: {e}")
            return 1.0, 1.0

    def normalize_audio(
        self,
        input_path: str,
        output_path: str,
        target_loudness: float = -16.0
    ) -> bool:
        """
        归一化音频

        Args:
            input_path: 输入音频
            output_path: 输出音频
            target_loudness: 目标响度

        Returns:
            是否成功
        """
        try:
            cmd = [
                'ffmpeg', '-y', '-i', input_path,
                '-af', f'loudnorm=I={target_loudness}:TP=-1.5:LRA=11',
                '-ar', '44100', '-ac', '2',
                output_path
            ]

            subprocess.run(cmd, capture_output=True, check=True, timeout=120)
            return os.path.exists(output_path)

        except Exception as e:
            print(f"   ❌ 音频归一化失败: {e}")
            return False

    def mix_audio_tracks(
        self,
        tracks: list,
        output_path: str,
        duration: Optional[float] = None
    ) -> bool:
        """
        混合多个音频轨道

        Args:
            tracks: 音频轨道列表 [(path, volume), ...]
            output_path: 输出路径
            duration: 目标时长(秒)

        Returns:
            是否成功
        """
        if not tracks:
            return False

        try:
            # 构建FFmpeg命令
            cmd = ['ffmpeg', '-y']

            # 添加输入
            for track_path, _ in tracks:
                cmd.extend(['-i', track_path])

            # 构建filter_complex
            filters = []
            for i, (_, volume) in enumerate(tracks):
                filters.append(f'[{i}:a]volume={volume}[a{i}]')

            # 混合所有轨道
            mix_inputs = ''.join([f'[a{i}]' for i in range(len(tracks))])
            filters.append(f'{mix_inputs}amix=inputs={len(tracks)}:duration=longest[aout]')

            cmd.extend(['-filter_complex', ';'.join(filters)])
            cmd.extend(['-map', '[aout]'])

            if duration:
                cmd.extend(['-t', str(duration)])

            cmd.extend(['-ar', '44100', '-ac', '2', output_path])

            subprocess.run(cmd, capture_output=True, check=True, timeout=180)
            return os.path.exists(output_path)

        except Exception as e:
            print(f"   ❌ 音频混合失败: {e}")
            return False

    def apply_fade(
        self,
        input_path: str,
        output_path: str,
        fade_in: float = 0.0,
        fade_out: float = 0.0,
        duration: Optional[float] = None
    ) -> bool:
        """
        应用淡入淡出效果

        Args:
            input_path: 输入音频
            output_path: 输出音频
            fade_in: 淡入时长(秒)
            fade_out: 淡出时长(秒)
            duration: 音频总时长(秒)

        Returns:
            是否成功
        """
        try:
            filters = []

            if fade_in > 0:
                filters.append(f'afade=t=in:st=0:d={fade_in}')

            if fade_out > 0 and duration:
                fade_out_start = max(0, duration - fade_out)
                filters.append(f'afade=t=out:st={fade_out_start}:d={fade_out}')

            if not filters:
                # 无需处理，直接复制
                import shutil
                shutil.copy2(input_path, output_path)
                return True

            cmd = [
                'ffmpeg', '-y', '-i', input_path,
                '-af', ','.join(filters),
                output_path
            ]

            subprocess.run(cmd, capture_output=True, check=True, timeout=120)
            return os.path.exists(output_path)

        except Exception as e:
            print(f"   ❌ 淡入淡出处理失败: {e}")
            return False

    @staticmethod
    def validate_volume(volume: float, name: str = "音量") -> float:
        """
        验证并限制音量范围

        Args:
            volume: 音量值
            name: 音量名称

        Returns:
            限制后的音量值
        """
        if not (AudioProcessor.MIN_VOLUME <= volume <= AudioProcessor.MAX_VOLUME):
            print(f"   ⚠️ {name} {volume} 超出范围，已限制到 [{AudioProcessor.MIN_VOLUME}, {AudioProcessor.MAX_VOLUME}]")
            return max(AudioProcessor.MIN_VOLUME, min(volume, AudioProcessor.MAX_VOLUME))
        return volume


# 便捷函数
def create_audio_processor() -> AudioProcessor:
    """创建音频处理器实例"""
    return AudioProcessor()
