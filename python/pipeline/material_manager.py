#!/usr/bin/env python3
"""
统一素材管理器
整合素材搜索、下载、缓存、TTS等功能
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import os
import json
import hashlib
import asyncio
from pathlib import Path
from typing import Optional, Dict, List
from datetime import datetime

# 导入子模块
try:
    from pipeline.material_search import MaterialSearchEngine, MaterialInfo
    from pipeline.tts_engine import TTSManager
    from pipeline.youtube_downloader import YouTubeDownloader
    MODULES_AVAILABLE = True
except ImportError:
    print("⚠️ 子模块未找到，请确保在正确的目录运行")
    MODULES_AVAILABLE = False


class MaterialManager:
    """统一素材管理器"""

    def __init__(self, config: Optional[Dict] = None, cache_dir: str = "./cache"):
        """
        初始化素材管理器

        Args:
            config: 配置字典
            cache_dir: 缓存目录
        """
        self.config = config or {}
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        # 缓存子目录
        self.video_cache_dir = self.cache_dir / "videos"
        self.audio_cache_dir = self.cache_dir / "audio"
        self.metadata_cache_dir = self.cache_dir / "metadata"

        for dir_path in [self.video_cache_dir, self.audio_cache_dir, self.metadata_cache_dir]:
            dir_path.mkdir(parents=True, exist_ok=True)

        # 初始化子模块
        if MODULES_AVAILABLE:
            self.search_engine = MaterialSearchEngine(config)
            self.tts_manager = TTSManager(config)
            self.youtube_downloader = YouTubeDownloader(str(self.video_cache_dir))
        else:
            self.search_engine = None
            self.tts_manager = None
            self.youtube_downloader = None

        # 加载缓存索引
        self.cache_index = self._load_cache_index()

    def _load_cache_index(self) -> Dict:
        """加载缓存索引"""
        index_file = self.metadata_cache_dir / "index.json"

        if index_file.exists():
            try:
                with open(index_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                pass

        return {
            "videos": {},
            "audio": {},
            "created_at": datetime.now().isoformat()
        }

    def _save_cache_index(self):
        """保存缓存索引"""
        index_file = self.metadata_cache_dir / "index.json"
        self.cache_index["updated_at"] = datetime.now().isoformat()

        with open(index_file, 'w', encoding='utf-8') as f:
            json.dump(self.cache_index, f, ensure_ascii=False, indent=2)

    def _get_cache_key(self, content: str) -> str:
        """生成缓存键"""
        return hashlib.md5(content.encode()).hexdigest()

    # ========== 视频素材管理 ==========

    def search_videos(
        self,
        keyword: str,
        platform: str = "all",
        orientation: str = "portrait",
        minimum_duration: int = 5,
        max_results: int = 10
    ) -> List[MaterialInfo]:
        """
        搜索视频素材

        Args:
            keyword: 搜索关键词
            platform: 平台(pexels/pixabay/all)
            orientation: 方向(portrait/landscape/square)
            minimum_duration: 最小时长
            max_results: 最大结果数

        Returns:
            素材列表
        """
        if not self.search_engine:
            print("❌ 搜索引擎未初始化")
            return []

        print(f"\n🔍 搜索视频素材: {keyword}")

        if platform == "pexels":
            results = self.search_engine.search_pexels(
                keyword, minimum_duration, orientation
            )
        elif platform == "pixabay":
            results = self.search_engine.search_pixabay(
                keyword, minimum_duration, orientation
            )
        else:
            results = self.search_engine.search_all(
                keyword, minimum_duration, orientation, max_results
            )

        return results

    def download_video(
        self,
        material: MaterialInfo,
        use_cache: bool = True
    ) -> Optional[str]:
        """
        下载视频素材

        Args:
            material: 素材信息
            use_cache: 是否使用缓存

        Returns:
            本地路径
        """
        # 生成缓存键
        cache_key = self._get_cache_key(material.url)

        # 检查缓存
        if use_cache and cache_key in self.cache_index["videos"]:
            cached_path = self.cache_index["videos"][cache_key]["path"]
            if os.path.exists(cached_path):
                print(f"   ✅ 使用缓存: {cached_path}")
                return cached_path

        # 下载
        filename = f"{cache_key}.mp4"
        save_path = self.search_engine.download_material(
            material,
            str(self.video_cache_dir),
            filename
        )

        if save_path:
            # 更新缓存索引
            self.cache_index["videos"][cache_key] = {
                "path": save_path,
                "url": material.url,
                "provider": material.provider,
                "duration": material.duration,
                "downloaded_at": datetime.now().isoformat()
            }
            self._save_cache_index()

        return save_path

    def get_video_from_cache(self, url: str) -> Optional[str]:
        """从缓存获取视频"""
        cache_key = self._get_cache_key(url)

        if cache_key in self.cache_index["videos"]:
            cached_path = self.cache_index["videos"][cache_key]["path"]
            if os.path.exists(cached_path):
                return cached_path

        return None

    # ========== TTS音频管理 ==========

    async def synthesize_speech(
        self,
        text: str,
        engine: str = "edge_tts",
        voice: str = "zh-CN-XiaoxiaoNeural",
        use_cache: bool = True,
        **kwargs
    ) -> Optional[str]:
        """
        合成语音

        Args:
            text: 文本内容
            engine: TTS引擎
            voice: 语音名称
            use_cache: 是否使用缓存
            **kwargs: 其他参数

        Returns:
            音频路径
        """
        if not self.tts_manager:
            print("❌ TTS管理器未初始化")
            return None

        # 生成缓存键
        cache_content = f"{engine}_{voice}_{text}"
        cache_key = self._get_cache_key(cache_content)

        # 检查缓存
        if use_cache and cache_key in self.cache_index["audio"]:
            cached_path = self.cache_index["audio"][cache_key]["path"]
            if os.path.exists(cached_path):
                print(f"   ✅ 使用缓存: {cached_path}")
                return cached_path

        # 合成
        filename = f"{cache_key}.mp3"
        output_path = str(self.audio_cache_dir / filename)

        success = await self.tts_manager.synthesize(
            text, output_path, engine, voice, **kwargs
        )

        if success:
            # 更新缓存索引
            self.cache_index["audio"][cache_key] = {
                "path": output_path,
                "text": text[:100],  # 只保存前100字符
                "engine": engine,
                "voice": voice,
                "synthesized_at": datetime.now().isoformat()
            }
            self._save_cache_index()
            return output_path

        return None

    async def batch_synthesize(
        self,
        texts: List[str],
        engine: str = "edge_tts",
        voice: str = "zh-CN-XiaoxiaoNeural",
        **kwargs
    ) -> List[Optional[str]]:
        """
        批量合成语音

        Args:
            texts: 文本列表
            engine: TTS引擎
            voice: 语音名称
            **kwargs: 其他参数

        Returns:
            音频路径列表
        """
        print(f"\n🎤 批量合成语音: {len(texts)} 条")

        tasks = [
            self.synthesize_speech(text, engine, voice, **kwargs)
            for text in texts
        ]

        results = await asyncio.gather(*tasks)
        return results

    # ========== YouTube下载管理 ==========

    def download_youtube(
        self,
        url: str,
        resolution: str = "720p",
        output_format: str = "mp4",
        filename: Optional[str] = None
    ) -> Optional[str]:
        """
        下载YouTube视频

        Args:
            url: YouTube视频URL
            resolution: 分辨率
            output_format: 输出格式
            filename: 自定义文件名

        Returns:
            视频路径
        """
        if not self.youtube_downloader:
            print("❌ YouTube下载器未初始化")
            return None

        print(f"\n📥 下载YouTube视频: {url}")

        try:
            task_id, output_path = self.youtube_downloader.download(
                url, resolution, output_format, filename
            )

            # 更新缓存索引
            cache_key = self._get_cache_key(url)
            self.cache_index["videos"][cache_key] = {
                "path": output_path,
                "url": url,
                "provider": "youtube",
                "resolution": resolution,
                "downloaded_at": datetime.now().isoformat()
            }
            self._save_cache_index()

            return output_path

        except Exception as e:
            print(f"❌ 下载失败: {e}")
            return None

    # ========== 缓存管理 ==========

    def get_cache_stats(self) -> Dict:
        """获取缓存统计"""
        video_count = len(self.cache_index["videos"])
        audio_count = len(self.cache_index["audio"])

        # 计算缓存大小
        video_size = sum(
            os.path.getsize(item["path"])
            for item in self.cache_index["videos"].values()
            if os.path.exists(item["path"])
        )

        audio_size = sum(
            os.path.getsize(item["path"])
            for item in self.cache_index["audio"].values()
            if os.path.exists(item["path"])
        )

        return {
            "video_count": video_count,
            "audio_count": audio_count,
            "video_size_mb": video_size / (1024 * 1024),
            "audio_size_mb": audio_size / (1024 * 1024),
            "total_size_mb": (video_size + audio_size) / (1024 * 1024)
        }

    def clear_cache(self, cache_type: str = "all"):
        """
        清理缓存

        Args:
            cache_type: 缓存类型(video/audio/all)
        """
        print(f"\n🗑️  清理缓存: {cache_type}")

        if cache_type in ["video", "all"]:
            for item in self.cache_index["videos"].values():
                path = item["path"]
                if os.path.exists(path):
                    os.remove(path)
                    print(f"   删除: {path}")
            self.cache_index["videos"] = {}

        if cache_type in ["audio", "all"]:
            for item in self.cache_index["audio"].values():
                path = item["path"]
                if os.path.exists(path):
                    os.remove(path)
                    print(f"   删除: {path}")
            self.cache_index["audio"] = {}

        self._save_cache_index()
        print("   ✅ 缓存清理完成")

    def export_cache_report(self, output_path: str):
        """导出缓存报告"""
        stats = self.get_cache_stats()

        report = {
            "generated_at": datetime.now().isoformat(),
            "statistics": stats,
            "videos": self.cache_index["videos"],
            "audio": self.cache_index["audio"]
        }

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

        print(f"✅ 缓存报告已导出: {output_path}")


def create_material_manager(config: Optional[Dict] = None, cache_dir: str = "./cache") -> MaterialManager:
    """创建素材管理器实例"""
    return MaterialManager(config, cache_dir)


# 命令行接口
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="统一素材管理工具")
    subparsers = parser.add_subparsers(dest="command", help="子命令")

    # 搜索视频
    search_parser = subparsers.add_parser("search", help="搜索视频素材")
    search_parser.add_argument("keyword", help="搜索关键词")
    search_parser.add_argument("--platform", choices=["pexels", "pixabay", "all"], default="all")
    search_parser.add_argument("--download", action="store_true", help="下载第一个结果")

    # 合成语音
    tts_parser = subparsers.add_parser("tts", help="合成语音")
    tts_parser.add_argument("text", help="文本内容")
    tts_parser.add_argument("--engine", default="edge_tts")
    tts_parser.add_argument("--voice", default="zh-CN-XiaoxiaoNeural")

    # YouTube下载
    youtube_parser = subparsers.add_parser("youtube", help="下载YouTube视频")
    youtube_parser.add_argument("url", help="YouTube视频URL")
    youtube_parser.add_argument("--resolution", "-r", default="720p")
    youtube_parser.add_argument("--format", "-f", default="mp4")
    youtube_parser.add_argument("--filename", help="自定义文件名")

    # 缓存管理
    cache_parser = subparsers.add_parser("cache", help="缓存管理")
    cache_parser.add_argument("action", choices=["stats", "clear", "report"])
    cache_parser.add_argument("--type", choices=["video", "audio", "all"], default="all")

    # 通用参数
    parser.add_argument("--cache-dir", default="./cache", help="缓存目录")
    parser.add_argument("--config", help="配置文件路径")

    args = parser.parse_args()

    # 加载配置
    config = {}
    if args.config and os.path.exists(args.config):
        with open(args.config, 'r', encoding='utf-8') as f:
            config = json.load(f)

    # 创建管理器
    manager = create_material_manager(config, args.cache_dir)

    # 执行命令
    if args.command == "search":
        results = manager.search_videos(args.keyword)
        print(f"\n📊 找到 {len(results)} 个素材")

        if args.download and results:
            manager.download_video(results[0])

    elif args.command == "tts":
        async def main():
            result = await manager.synthesize_speech(args.text, args.engine, args.voice)
            if result:
                print(f"\n✅ 合成完成: {result}")

        asyncio.run(main())

    elif args.command == "youtube":
        result = manager.download_youtube(
            args.url,
            args.resolution,
            args.format,
            args.filename
        )
        if result:
            print(f"\n✅ 下载完成: {result}")

    elif args.command == "cache":
        if args.action == "stats":
            stats = manager.get_cache_stats()
            print(f"\n📊 缓存统计:")
            print(f"   视频: {stats['video_count']} 个, {stats['video_size_mb']:.2f} MB")
            print(f"   音频: {stats['audio_count']} 个, {stats['audio_size_mb']:.2f} MB")
            print(f"   总计: {stats['total_size_mb']:.2f} MB")

        elif args.action == "clear":
            manager.clear_cache(args.type)

        elif args.action == "report":
            report_path = "cache_report.json"
            manager.export_cache_report(report_path)
