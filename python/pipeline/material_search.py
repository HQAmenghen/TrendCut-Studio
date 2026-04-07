#!/usr/bin/env python3
"""
素材搜索引擎 - 从 NarratoAI 移植
支持 Pexels、Pixabay 等平台的视频素材搜索
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import os
import requests
import json
from urllib.parse import urlencode
from typing import List, Optional, Dict
from pathlib import Path

# 素材信息数据类
class MaterialInfo:
    """素材信息"""
    def __init__(self):
        self.provider = ""  # 提供商: pexels, pixabay
        self.url = ""       # 视频URL
        self.duration = 0   # 时长(秒)
        self.width = 0      # 宽度
        self.height = 0     # 高度
        self.thumbnail = "" # 缩略图
        self.tags = []      # 标签

    def to_dict(self):
        return {
            "provider": self.provider,
            "url": self.url,
            "duration": self.duration,
            "width": self.width,
            "height": self.height,
            "thumbnail": self.thumbnail,
            "tags": self.tags
        }


class MaterialSearchEngine:
    """素材搜索引擎"""

    # 视频方向
    ORIENTATION_PORTRAIT = "portrait"   # 竖屏 9:16
    ORIENTATION_LANDSCAPE = "landscape" # 横屏 16:9
    ORIENTATION_SQUARE = "square"       # 方形 1:1

    # 分辨率映射
    RESOLUTIONS = {
        "portrait": (1080, 1920),
        "landscape": (1920, 1080),
        "square": (1080, 1080)
    }

    def __init__(self, config: Optional[Dict] = None):
        """
        初始化搜索引擎

        Args:
            config: 配置字典，包含API密钥等
        """
        self.config = config or {}
        self.pexels_api_key = self.config.get('pexels_api_key', '')
        self.pixabay_api_key = self.config.get('pixabay_api_key', '')
        self.proxy = self.config.get('proxy', None)
        self.timeout = self.config.get('timeout', (30, 60))

        # 请求计数（用于API密钥轮换）
        self.request_count = 0

    def get_api_key(self, key_name: str) -> str:
        """
        获取API密钥（支持多密钥轮换）

        Args:
            key_name: 密钥名称

        Returns:
            API密钥
        """
        api_keys = self.config.get(key_name, '')

        if not api_keys:
            raise ValueError(f"未配置 {key_name}，请在配置中设置")

        # 如果是单个密钥，直接返回
        if isinstance(api_keys, str):
            return api_keys

        # 如果是多个密钥，轮换使用
        self.request_count += 1
        return api_keys[self.request_count % len(api_keys)]

    def search_pexels(
        self,
        search_term: str,
        minimum_duration: int = 5,
        orientation: str = ORIENTATION_PORTRAIT,
        per_page: int = 20
    ) -> List[MaterialInfo]:
        """
        在 Pexels 搜索视频素材

        Args:
            search_term: 搜索关键词
            minimum_duration: 最小时长(秒)
            orientation: 视频方向
            per_page: 每页结果数

        Returns:
            素材信息列表
        """
        try:
            api_key = self.get_api_key('pexels_api_key')
        except ValueError as e:
            print(f"   ⚠️ {e}")
            return []

        headers = {"Authorization": api_key}
        params = {
            "query": search_term,
            "per_page": per_page,
            "orientation": orientation
        }

        query_url = f"https://api.pexels.com/videos/search?{urlencode(params)}"
        print(f"   🔍 搜索 Pexels: {search_term} ({orientation})")

        try:
            response = requests.get(
                query_url,
                headers=headers,
                proxies=self.proxy,
                verify=False,
                timeout=self.timeout
            )

            data = response.json()

            if "videos" not in data:
                print(f"   ❌ Pexels 搜索失败: {data}")
                return []

            video_items = []
            target_width, target_height = self.RESOLUTIONS.get(orientation, (1080, 1920))

            for video in data["videos"]:
                duration = video.get("duration", 0)

                # 检查时长
                if duration < minimum_duration:
                    continue

                # 查找匹配分辨率的视频
                video_files = video.get("video_files", [])
                for video_file in video_files:
                    w = int(video_file.get("width", 0))
                    h = int(video_file.get("height", 0))

                    if w == target_width and h == target_height:
                        item = MaterialInfo()
                        item.provider = "pexels"
                        item.url = video_file.get("link", "")
                        item.duration = duration
                        item.width = w
                        item.height = h
                        item.thumbnail = video.get("image", "")
                        item.tags = video.get("tags", [])
                        video_items.append(item)
                        break

            print(f"   ✅ Pexels 找到 {len(video_items)} 个素材")
            return video_items

        except Exception as e:
            print(f"   ❌ Pexels 搜索异常: {e}")
            return []

    def search_pixabay(
        self,
        search_term: str,
        minimum_duration: int = 5,
        orientation: str = ORIENTATION_PORTRAIT,
        per_page: int = 50
    ) -> List[MaterialInfo]:
        """
        在 Pixabay 搜索视频素材

        Args:
            search_term: 搜索关键词
            minimum_duration: 最小时长(秒)
            orientation: 视频方向
            per_page: 每页结果数

        Returns:
            素材信息列表
        """
        try:
            api_key = self.get_api_key('pixabay_api_key')
        except ValueError as e:
            print(f"   ⚠️ {e}")
            return []

        params = {
            "q": search_term,
            "video_type": "all",
            "per_page": per_page,
            "key": api_key
        }

        query_url = f"https://pixabay.com/api/videos/?{urlencode(params)}"
        print(f"   🔍 搜索 Pixabay: {search_term}")

        try:
            response = requests.get(
                query_url,
                proxies=self.proxy,
                verify=False,
                timeout=self.timeout
            )

            data = response.json()

            if "hits" not in data:
                print(f"   ❌ Pixabay 搜索失败: {data}")
                return []

            video_items = []
            target_width, target_height = self.RESOLUTIONS.get(orientation, (1080, 1920))

            for video in data["hits"]:
                duration = video.get("duration", 0)

                # 检查时长
                if duration < minimum_duration:
                    continue

                # 查找合适分辨率的视频
                video_files = video.get("videos", {})
                for quality, video_file in video_files.items():
                    w = int(video_file.get("width", 0))
                    h = int(video_file.get("height", 0))

                    # Pixabay 可能没有精确匹配，选择宽度大于等于目标的
                    if w >= target_width:
                        item = MaterialInfo()
                        item.provider = "pixabay"
                        item.url = video_file.get("url", "")
                        item.duration = duration
                        item.width = w
                        item.height = h
                        item.thumbnail = video.get("picture_id", "")
                        item.tags = video.get("tags", "").split(", ")
                        video_items.append(item)
                        break

            print(f"   ✅ Pixabay 找到 {len(video_items)} 个素材")
            return video_items

        except Exception as e:
            print(f"   ❌ Pixabay 搜索异常: {e}")
            return []

    def search_all(
        self,
        search_term: str,
        minimum_duration: int = 5,
        orientation: str = ORIENTATION_PORTRAIT,
        max_results: int = 10
    ) -> List[MaterialInfo]:
        """
        在所有平台搜索素材

        Args:
            search_term: 搜索关键词
            minimum_duration: 最小时长(秒)
            orientation: 视频方向
            max_results: 最大结果数

        Returns:
            素材信息列表
        """
        all_materials = []

        # 搜索 Pexels
        if self.pexels_api_key:
            pexels_results = self.search_pexels(
                search_term, minimum_duration, orientation
            )
            all_materials.extend(pexels_results)

        # 搜索 Pixabay
        if self.pixabay_api_key:
            pixabay_results = self.search_pixabay(
                search_term, minimum_duration, orientation
            )
            all_materials.extend(pixabay_results)

        # 限制结果数量
        return all_materials[:max_results]

    def download_material(
        self,
        material: MaterialInfo,
        save_dir: str,
        filename: Optional[str] = None
    ) -> Optional[str]:
        """
        下载素材

        Args:
            material: 素材信息
            save_dir: 保存目录
            filename: 文件名（可选）

        Returns:
            保存路径，失败返回None
        """
        if not material.url:
            print("   ❌ 素材URL为空")
            return None

        # 创建保存目录
        os.makedirs(save_dir, exist_ok=True)

        # 生成文件名
        if not filename:
            from datetime import datetime
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"{material.provider}_{timestamp}.mp4"

        save_path = os.path.join(save_dir, filename)

        print(f"   📥 下载素材: {material.url}")

        try:
            response = requests.get(
                material.url,
                stream=True,
                proxies=self.proxy,
                verify=False,
                timeout=self.timeout
            )

            total_size = int(response.headers.get('content-length', 0))
            downloaded = 0

            with open(save_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)

                        # 显示进度
                        if total_size > 0:
                            progress = (downloaded / total_size) * 100
                            print(f"\r   进度: {progress:.1f}%", end='')

            print(f"\n   ✅ 下载完成: {save_path}")
            return save_path

        except Exception as e:
            print(f"\n   ❌ 下载失败: {e}")
            if os.path.exists(save_path):
                os.remove(save_path)
            return None


def create_search_engine(config: Optional[Dict] = None) -> MaterialSearchEngine:
    """创建搜索引擎实例"""
    return MaterialSearchEngine(config)


# 命令行接口
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="素材搜索工具")
    parser.add_argument("keyword", help="搜索关键词")
    parser.add_argument("--platform", choices=["pexels", "pixabay", "all"], default="all", help="搜索平台")
    parser.add_argument("--orientation", choices=["portrait", "landscape", "square"], default="portrait", help="视频方向")
    parser.add_argument("--duration", type=int, default=5, help="最小时长(秒)")
    parser.add_argument("--max-results", type=int, default=10, help="最大结果数")
    parser.add_argument("--download", action="store_true", help="下载第一个结果")
    parser.add_argument("--output-dir", default="./materials", help="下载目录")
    parser.add_argument("--pexels-key", help="Pexels API Key")
    parser.add_argument("--pixabay-key", help="Pixabay API Key")

    args = parser.parse_args()

    # 构建配置
    config = {}
    if args.pexels_key:
        config['pexels_api_key'] = args.pexels_key
    if args.pixabay_key:
        config['pixabay_api_key'] = args.pixabay_key

    # 创建搜索引擎
    engine = create_search_engine(config)

    # 搜索素材
    print(f"\n🔍 搜索关键词: {args.keyword}")
    print(f"   平台: {args.platform}")
    print(f"   方向: {args.orientation}")
    print(f"   最小时长: {args.duration}秒")
    print()

    if args.platform == "pexels":
        results = engine.search_pexels(args.keyword, args.duration, args.orientation)
    elif args.platform == "pixabay":
        results = engine.search_pixabay(args.keyword, args.duration, args.orientation)
    else:
        results = engine.search_all(args.keyword, args.duration, args.orientation, args.max_results)

    # 显示结果
    print(f"\n📊 搜索结果: 共 {len(results)} 个")
    print("=" * 60)

    for i, material in enumerate(results, 1):
        print(f"\n{i}. [{material.provider}] {material.duration}秒 {material.width}x{material.height}")
        print(f"   URL: {material.url}")
        if material.tags:
            print(f"   标签: {', '.join(material.tags[:5])}")

    # 下载第一个结果
    if args.download and results:
        print(f"\n📥 下载第一个结果...")
        engine.download_material(results[0], args.output_dir)
