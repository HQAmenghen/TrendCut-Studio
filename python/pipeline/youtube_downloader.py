#!/usr/bin/env python3
"""
YouTube视频下载器
支持多种分辨率和格式的YouTube视频下载
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import os
import yt_dlp
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from uuid import uuid4


class YouTubeDownloader:
    """YouTube视频下载器"""

    SUPPORTED_FORMATS = ['mp4', 'mkv', 'webm', 'flv', 'avi']

    def __init__(self, output_dir: str = "./downloads"):
        """
        初始化下载器

        Args:
            output_dir: 下载目录
        """
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def get_video_info(self, url: str) -> Dict:
        """
        获取视频信息

        Args:
            url: YouTube视频URL

        Returns:
            视频信息字典
        """
        ydl_opts = {
            'quiet': True,
            'no_warnings': True
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                return {
                    'title': info.get('title', 'Unknown'),
                    'duration': info.get('duration', 0),
                    'uploader': info.get('uploader', 'Unknown'),
                    'view_count': info.get('view_count', 0),
                    'description': info.get('description', '')
                }
        except Exception as e:
            print(f"❌ 获取视频信息失败: {e}")
            raise

    def get_available_formats(self, url: str) -> List[Dict]:
        """
        获取可用的视频格式列表

        Args:
            url: YouTube视频URL

        Returns:
            格式列表
        """
        ydl_opts = {
            'quiet': True,
            'no_warnings': True
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                formats = info.get('formats', [])

                format_list = []
                seen_resolutions = set()

                for f in formats:
                    resolution = f.get('format_note', 'N/A')
                    vcodec = f.get('vcodec', 'N/A')

                    # 只保留有视频编码的格式
                    if vcodec != 'none' and resolution != 'N/A':
                        # 标准化分辨率
                        base_resolution = resolution.split('p')[0] + 'p' if 'p' in resolution else resolution

                        if base_resolution not in seen_resolutions:
                            format_info = {
                                'format_id': f.get('format_id', 'N/A'),
                                'ext': f.get('ext', 'N/A'),
                                'resolution': base_resolution,
                                'filesize': f.get('filesize', 'N/A'),
                                'vcodec': vcodec,
                                'acodec': f.get('acodec', 'N/A')
                            }
                            format_list.append(format_info)
                            seen_resolutions.add(base_resolution)

                # 按分辨率排序
                format_list.sort(key=lambda x: int(x['resolution'].replace('p', '')) if x['resolution'] != 'N/A' else 0, reverse=True)
                return format_list

        except Exception as e:
            print(f"❌ 获取视频格式失败: {e}")
            raise

    def download(
        self,
        url: str,
        resolution: str = "720p",
        output_format: str = "mp4",
        filename: Optional[str] = None
    ) -> Tuple[str, str]:
        """
        下载YouTube视频

        Args:
            url: YouTube视频URL
            resolution: 目标分辨率 (2160p/1440p/1080p/720p/480p/360p)
            output_format: 输出格式 (mp4/mkv/webm/flv/avi)
            filename: 自定义文件名（不含扩展名）

        Returns:
            (task_id, output_path)
        """
        # 验证格式
        if output_format.lower() not in self.SUPPORTED_FORMATS:
            raise ValueError(
                f"不支持的格式: {output_format}。"
                f"支持的格式: {', '.join(self.SUPPORTED_FORMATS)}"
            )

        task_id = str(uuid4())[:8]

        # 标准化分辨率
        base_resolution = resolution.split('p')[0] + 'p'

        print(f"\n📥 开始下载视频")
        print(f"   URL: {url}")
        print(f"   分辨率: {base_resolution}")
        print(f"   格式: {output_format}")

        try:
            # 获取可用格式
            formats = self.get_available_formats(url)

            # 查找目标分辨率
            target_format = None
            for fmt in formats:
                if fmt['resolution'] == base_resolution:
                    target_format = fmt
                    break

            if not target_format:
                available = [f['resolution'] for f in formats]
                raise ValueError(
                    f"未找到 {base_resolution} 分辨率。"
                    f"可用分辨率: {', '.join(available)}"
                )

            # 设置输出文件名
            if filename:
                output_filename = f"{filename}.{output_format}"
            else:
                output_filename = f"{task_id}_%(title)s.{output_format}"

            output_template = str(self.output_dir / output_filename)

            # 下载选项
            ydl_opts = {
                'format': f"{target_format['format_id']}+bestaudio[ext=m4a]/best",
                'outtmpl': output_template,
                'merge_output_format': output_format.lower(),
                'postprocessors': [{
                    'key': 'FFmpegVideoConvertor',
                    'preferedformat': output_format.lower(),
                }],
                'progress_hooks': [self._progress_hook]
            }

            # 执行下载
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)

                if filename:
                    output_path = str(self.output_dir / output_filename)
                else:
                    video_title = info.get('title', task_id)
                    # 清理文件名中的非法字符
                    safe_title = "".join(c for c in video_title if c.isalnum() or c in (' ', '-', '_')).strip()
                    output_filename = f"{task_id}_{safe_title}.{output_format}"
                    output_path = str(self.output_dir / output_filename)

            print(f"\n✅ 下载完成: {output_path}")
            return task_id, output_path

        except Exception as e:
            print(f"\n❌ 下载失败: {e}")
            raise

    def _progress_hook(self, d):
        """下载进度回调"""
        if d['status'] == 'downloading':
            percent = d.get('_percent_str', 'N/A')
            speed = d.get('_speed_str', 'N/A')
            eta = d.get('_eta_str', 'N/A')
            print(f"\r   进度: {percent} | 速度: {speed} | 剩余: {eta}", end='', flush=True)
        elif d['status'] == 'finished':
            print(f"\n   ✅ 下载完成，正在处理...")


def create_downloader(output_dir: str = "./downloads") -> YouTubeDownloader:
    """创建下载器实例"""
    return YouTubeDownloader(output_dir)


# 命令行接口
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="YouTube视频下载工具")
    parser.add_argument("url", help="YouTube视频URL")
    parser.add_argument("--resolution", "-r", default="720p",
                       choices=["2160p", "1440p", "1080p", "720p", "480p", "360p"],
                       help="视频分辨率")
    parser.add_argument("--format", "-f", default="mp4",
                       choices=YouTubeDownloader.SUPPORTED_FORMATS,
                       help="输出格式")
    parser.add_argument("--output", "-o", help="输出文件名（不含扩展名）")
    parser.add_argument("--output-dir", "-d", default="./downloads", help="输出目录")
    parser.add_argument("--info", action="store_true", help="仅显示视频信息")
    parser.add_argument("--list-formats", action="store_true", help="列出可用格式")

    args = parser.parse_args()

    downloader = create_downloader(args.output_dir)

    if args.info:
        # 显示视频信息
        info = downloader.get_video_info(args.url)
        print("\n📺 视频信息:")
        print(f"   标题: {info['title']}")
        print(f"   时长: {info['duration']}秒")
        print(f"   上传者: {info['uploader']}")
        print(f"   观看次数: {info['view_count']}")

    elif args.list_formats:
        # 列出可用格式
        formats = downloader.get_available_formats(args.url)
        print("\n📋 可用格式:")
        for fmt in formats:
            size = fmt['filesize']
            size_str = f"{size / (1024*1024):.1f}MB" if isinstance(size, int) else "未知"
            print(f"   {fmt['resolution']:8s} | {fmt['ext']:5s} | {size_str:10s} | {fmt['vcodec']}")

    else:
        # 下载视频
        task_id, output_path = downloader.download(
            args.url,
            args.resolution,
            args.format,
            args.output
        )
