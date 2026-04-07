#!/usr/bin/env python3
"""
TTS语音合成引擎 - 从 NarratoAI 移植
支持 Edge TTS、Azure Speech、腾讯云TTS等多种引擎
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import os
import asyncio
import json
from typing import Optional, Dict, List, Tuple
from pathlib import Path

# Edge TTS支持
try:
    import edge_tts
    from edge_tts import SubMaker
    EDGE_TTS_AVAILABLE = True
except ImportError:
    EDGE_TTS_AVAILABLE = False
    print("⚠️ edge-tts 未安装，Edge TTS功能不可用")

# Azure Speech支持
try:
    import azure.cognitiveservices.speech as speechsdk
    AZURE_SPEECH_AVAILABLE = True
except ImportError:
    AZURE_SPEECH_AVAILABLE = False
    print("⚠️ azure-cognitiveservices-speech 未安装，Azure Speech功能不可用")


class TTSEngine:
    """TTS引擎基类"""

    def __init__(self, config: Optional[Dict] = None):
        self.config = config or {}

    async def synthesize(
        self,
        text: str,
        output_path: str,
        voice: str,
        **kwargs
    ) -> bool:
        """
        合成语音

        Args:
            text: 文本内容
            output_path: 输出路径
            voice: 语音名称
            **kwargs: 其他参数

        Returns:
            是否成功
        """
        raise NotImplementedError

    def get_duration(self, audio_path: str) -> float:
        """
        获取音频时长

        Args:
            audio_path: 音频文件路径

        Returns:
            时长(秒)
        """
        try:
            import subprocess
            result = subprocess.run(
                ['ffprobe', '-v', 'error', '-show_entries',
                 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1',
                 audio_path],
                capture_output=True,
                text=True,
                timeout=10
            )
            return float(result.stdout.strip())
        except:
            return 0.0


class EdgeTTSEngine(TTSEngine):
    """Edge TTS引擎"""

    # 常用中文语音
    CHINESE_VOICES = {
        "xiaoxiao": "zh-CN-XiaoxiaoNeural",  # 女声
        "xiaoyi": "zh-CN-XiaoyiNeural",      # 女声
        "yunjian": "zh-CN-YunjianNeural",    # 男声
        "yunxi": "zh-CN-YunxiNeural",        # 男声
        "yunxia": "zh-CN-YunxiaNeural",      # 男声
        "yunyang": "zh-CN-YunyangNeural",    # 男声
    }

    def __init__(self, config: Optional[Dict] = None):
        super().__init__(config)

        if not EDGE_TTS_AVAILABLE:
            raise RuntimeError("Edge TTS 未安装，请运行: pip install edge-tts")

    async def synthesize(
        self,
        text: str,
        output_path: str,
        voice: str = "zh-CN-XiaoxiaoNeural",
        rate: str = "+0%",
        volume: str = "+0%",
        pitch: str = "+0Hz"
    ) -> bool:
        """
        使用 Edge TTS 合成语音

        Args:
            text: 文本内容
            output_path: 输出路径
            voice: 语音名称
            rate: 语速调整
            volume: 音量调整
            pitch: 音调调整

        Returns:
            是否成功
        """
        try:
            # 创建输出目录
            os.makedirs(os.path.dirname(output_path), exist_ok=True)

            # 创建TTS通信器
            communicate = edge_tts.Communicate(
                text=text,
                voice=voice,
                rate=rate,
                volume=volume,
                pitch=pitch
            )

            # 保存音频
            await communicate.save(output_path)

            # 检查文件
            if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                print(f"   ✅ Edge TTS 合成成功: {output_path}")
                return True
            else:
                print(f"   ❌ Edge TTS 合成失败: 文件无效")
                return False

        except Exception as e:
            print(f"   ❌ Edge TTS 合成异常: {e}")
            return False

    async def synthesize_with_subtitle(
        self,
        text: str,
        audio_path: str,
        subtitle_path: str,
        voice: str = "zh-CN-XiaoxiaoNeural",
        **kwargs
    ) -> bool:
        """
        合成语音并生成字幕

        Args:
            text: 文本内容
            audio_path: 音频输出路径
            subtitle_path: 字幕输出路径
            voice: 语音名称
            **kwargs: 其他参数

        Returns:
            是否成功
        """
        try:
            os.makedirs(os.path.dirname(audio_path), exist_ok=True)
            os.makedirs(os.path.dirname(subtitle_path), exist_ok=True)

            rate = kwargs.get('rate', '+0%')
            volume = kwargs.get('volume', '+0%')
            pitch = kwargs.get('pitch', '+0Hz')

            communicate = edge_tts.Communicate(
                text=text,
                voice=voice,
                rate=rate,
                volume=volume,
                pitch=pitch
            )

            # 创建字幕生成器
            sub_maker = SubMaker()

            # 保存音频并收集字幕信息
            with open(audio_path, 'wb') as audio_file:
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        audio_file.write(chunk["data"])
                    elif chunk["type"] == "WordBoundary":
                        sub_maker.create_sub(
                            (chunk["offset"], chunk["duration"]),
                            chunk["text"]
                        )

            # 生成字幕文件
            with open(subtitle_path, 'w', encoding='utf-8') as subtitle_file:
                subtitle_file.write(sub_maker.generate_subs())

            print(f"   ✅ Edge TTS 合成成功（含字幕）")
            return True

        except Exception as e:
            print(f"   ❌ Edge TTS 合成异常: {e}")
            return False


class AzureSpeechEngine(TTSEngine):
    """Azure Speech引擎"""

    def __init__(self, config: Optional[Dict] = None):
        super().__init__(config)

        if not AZURE_SPEECH_AVAILABLE:
            raise RuntimeError("Azure Speech SDK 未安装，请运行: pip install azure-cognitiveservices-speech")

        self.speech_key = self.config.get('azure_speech_key', '')
        self.speech_region = self.config.get('azure_speech_region', '')

        if not self.speech_key or not self.speech_region:
            raise ValueError("Azure Speech 配置不完整，需要 speech_key 和 speech_region")

    async def synthesize(
        self,
        text: str,
        output_path: str,
        voice: str = "zh-CN-XiaoxiaoNeural",
        rate: float = 1.0,
        volume: float = 1.0,
        pitch: float = 0
    ) -> bool:
        """
        使用 Azure Speech 合成语音

        Args:
            text: 文本内容
            output_path: 输出路径
            voice: 语音名称
            rate: 语速(0.5-2.0)
            volume: 音量(0.0-2.0)
            pitch: 音调(-50到+50)

        Returns:
            是否成功
        """
        try:
            os.makedirs(os.path.dirname(output_path), exist_ok=True)

            # 配置语音服务
            speech_config = speechsdk.SpeechConfig(
                subscription=self.speech_key,
                region=self.speech_region
            )
            speech_config.speech_synthesis_voice_name = voice

            # 配置音频输出
            audio_config = speechsdk.audio.AudioOutputConfig(
                filename=output_path
            )

            # 创建合成器
            synthesizer = speechsdk.SpeechSynthesizer(
                speech_config=speech_config,
                audio_config=audio_config
            )

            # 构建SSML
            ssml = f"""
            <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>
                <voice name='{voice}'>
                    <prosody rate='{rate}' volume='{volume}' pitch='{pitch:+d}Hz'>
                        {text}
                    </prosody>
                </voice>
            </speak>
            """

            # 合成语音
            result = synthesizer.speak_ssml_async(ssml).get()

            if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
                print(f"   ✅ Azure Speech 合成成功: {output_path}")
                return True
            else:
                print(f"   ❌ Azure Speech 合成失败: {result.reason}")
                return False

        except Exception as e:
            print(f"   ❌ Azure Speech 合成异常: {e}")
            return False


class TTSManager:
    """TTS管理器 - 统一接口"""

    ENGINE_EDGE = "edge_tts"
    ENGINE_AZURE = "azure_speech"

    def __init__(self, config: Optional[Dict] = None):
        """
        初始化TTS管理器

        Args:
            config: 配置字典
        """
        self.config = config or {}
        self.engines = {}

        # 初始化可用引擎
        self._init_engines()

    def _init_engines(self):
        """初始化引擎"""
        # Edge TTS
        if EDGE_TTS_AVAILABLE:
            try:
                self.engines[self.ENGINE_EDGE] = EdgeTTSEngine(self.config)
                print("✅ Edge TTS 引擎已加载")
            except Exception as e:
                print(f"⚠️ Edge TTS 引擎加载失败: {e}")

        # Azure Speech
        if AZURE_SPEECH_AVAILABLE:
            try:
                self.engines[self.ENGINE_AZURE] = AzureSpeechEngine(self.config)
                print("✅ Azure Speech 引擎已加载")
            except Exception as e:
                print(f"⚠️ Azure Speech 引擎加载失败: {e}")

    def get_engine(self, engine_name: str) -> Optional[TTSEngine]:
        """
        获取引擎

        Args:
            engine_name: 引擎名称

        Returns:
            引擎实例
        """
        return self.engines.get(engine_name)

    async def synthesize(
        self,
        text: str,
        output_path: str,
        engine: str = ENGINE_EDGE,
        voice: str = "zh-CN-XiaoxiaoNeural",
        **kwargs
    ) -> bool:
        """
        合成语音

        Args:
            text: 文本内容
            output_path: 输出路径
            engine: 引擎名称
            voice: 语音名称
            **kwargs: 其他参数

        Returns:
            是否成功
        """
        tts_engine = self.get_engine(engine)

        if not tts_engine:
            print(f"   ❌ 引擎 {engine} 不可用")
            return False

        return await tts_engine.synthesize(text, output_path, voice, **kwargs)

    def list_engines(self) -> List[str]:
        """列出可用引擎"""
        return list(self.engines.keys())


def create_tts_manager(config: Optional[Dict] = None) -> TTSManager:
    """创建TTS管理器实例"""
    return TTSManager(config)


# 命令行接口
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="TTS语音合成工具")
    parser.add_argument("text", help="要合成的文本")
    parser.add_argument("--output", "-o", default="output.mp3", help="输出文件路径")
    parser.add_argument("--engine", choices=["edge_tts", "azure_speech"], default="edge_tts", help="TTS引擎")
    parser.add_argument("--voice", default="zh-CN-XiaoxiaoNeural", help="语音名称")
    parser.add_argument("--rate", default="+0%", help="语速调整")
    parser.add_argument("--volume", default="+0%", help="音量调整")
    parser.add_argument("--pitch", default="+0Hz", help="音调调整")
    parser.add_argument("--subtitle", help="字幕输出路径（仅Edge TTS支持）")
    parser.add_argument("--azure-key", help="Azure Speech Key")
    parser.add_argument("--azure-region", help="Azure Speech Region")

    args = parser.parse_args()

    # 构建配置
    config = {}
    if args.azure_key:
        config['azure_speech_key'] = args.azure_key
    if args.azure_region:
        config['azure_speech_region'] = args.azure_region

    # 创建TTS管理器
    manager = create_tts_manager(config)

    print(f"\n🎤 TTS语音合成")
    print(f"   引擎: {args.engine}")
    print(f"   语音: {args.voice}")
    print(f"   文本: {args.text}")
    print()

    # 合成语音
    async def main():
        if args.subtitle and args.engine == "edge_tts":
            # 使用Edge TTS生成字幕
            engine = manager.get_engine("edge_tts")
            success = await engine.synthesize_with_subtitle(
                args.text,
                args.output,
                args.subtitle,
                args.voice,
                rate=args.rate,
                volume=args.volume,
                pitch=args.pitch
            )
        else:
            # 普通合成
            success = await manager.synthesize(
                args.text,
                args.output,
                args.engine,
                args.voice,
                rate=args.rate,
                volume=args.volume,
                pitch=args.pitch
            )

        if success:
            print(f"\n✅ 合成完成: {args.output}")
            if args.subtitle:
                print(f"✅ 字幕文件: {args.subtitle}")
        else:
            print(f"\n❌ 合成失败")
            sys.exit(1)

    asyncio.run(main())
