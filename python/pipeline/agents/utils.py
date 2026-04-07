"""
公共工具函数模块
提供 JSON 读写、文本处理、时长统计等通用功能
"""
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional


def load_json(path_str: str, default: Any = None) -> Any:
    """
    安全加载 JSON 文件

    Args:
        path_str: 文件路径
        default: 文件不存在或解析失败时的默认值

    Returns:
        解析后的 JSON 数据或默认值
    """
    path = Path(path_str)
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"⚠️ 读取 {path_str} 失败: {e}")
        return default


def write_json(path_str: str, data: Any, indent: int = 2) -> bool:
    """
    写入 JSON 文件

    Args:
        path_str: 文件路径
        data: 要写入的数据
        indent: 缩进空格数

    Returns:
        是否写入成功
    """
    try:
        path = Path(path_str)
        path.write_text(
            json.dumps(data, ensure_ascii=False, indent=indent),
            encoding="utf-8"
        )
        return True
    except Exception as e:
        print(f"❌ 写入 {path_str} 失败: {e}")
        return False


def safe_text(value: Any, limit: int = 220) -> str:
    """
    安全处理文本，去除多余空白并限制长度

    Args:
        value: 输入值
        limit: 最大长度

    Returns:
        处理后的文本
    """
    text = " ".join(str(value or "").split()).strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "..."


def normalize_text(text: str) -> str:
    """
    标准化文本，去除所有空白字符（用于文本比较）

    Args:
        text: 输入文本

    Returns:
        标准化后的文本
    """
    return re.sub(r"\s+", "", str(text or "").strip())


def calculate_duration(items: List[Dict], start_key: str = "start", end_key: str = "end") -> float:
    """
    计算时间轴项目的总时长

    Args:
        items: 包含时间信息的项目列表
        start_key: 开始时间的键名
        end_key: 结束时间的键名

    Returns:
        总时长（秒）
    """
    if not items:
        return 0.0

    max_end = 0.0
    for item in items:
        end_time = float(item.get(end_key, 0))
        max_end = max(max_end, end_time)

    return max_end


def calculate_ratio(part: float, total: float) -> float:
    """
    计算比例

    Args:
        part: 部分值
        total: 总值

    Returns:
        比例（0-1之间），总值为0时返回0
    """
    if total <= 0:
        return 0.0
    return min(1.0, max(0.0, part / total))


def extract_time_ranges(items: List[Dict], start_key: str = "start", end_key: str = "end") -> List[tuple]:
    """
    提取时间范围列表

    Args:
        items: 包含时间信息的项目列表
        start_key: 开始时间的键名
        end_key: 结束时间的键名

    Returns:
        时间范围元组列表 [(start, end), ...]
    """
    ranges = []
    for item in items:
        start = float(item.get(start_key, 0))
        end = float(item.get(end_key, 0))
        if end > start:
            ranges.append((start, end))
    return ranges


def merge_overlapping_ranges(ranges: List[tuple]) -> List[tuple]:
    """
    合并重叠的时间范围

    Args:
        ranges: 时间范围列表 [(start, end), ...]

    Returns:
        合并后的时间范围列表
    """
    if not ranges:
        return []

    # 按开始时间排序
    sorted_ranges = sorted(ranges, key=lambda x: x[0])
    merged = [sorted_ranges[0]]

    for current in sorted_ranges[1:]:
        last = merged[-1]
        # 如果当前范围与上一个重叠，合并
        if current[0] <= last[1]:
            merged[-1] = (last[0], max(last[1], current[1]))
        else:
            merged.append(current)

    return merged


def calculate_coverage_duration(ranges: List[tuple]) -> float:
    """
    计算时间范围的总覆盖时长（自动合并重叠部分）

    Args:
        ranges: 时间范围列表 [(start, end), ...]

    Returns:
        总覆盖时长（秒）
    """
    merged = merge_overlapping_ranges(ranges)
    return sum(end - start for start, end in merged)


def split_sentences(text: str, max_length: int = 200) -> List[str]:
    """
    将文本按句子分割

    Args:
        text: 输入文本
        max_length: 单句最大长度

    Returns:
        句子列表
    """
    normalized = safe_text(text, max_length)
    if not normalized:
        return []

    # 按中英文标点分割
    parts = [
        part.strip()
        for part in re.split(r"[。！？；;?!]\s*", normalized)
        if part.strip()
    ]
    return parts


def format_time(seconds: float) -> str:
    """
    格式化时间为可读字符串

    Args:
        seconds: 秒数

    Returns:
        格式化的时间字符串（如 "1:23.5"）
    """
    minutes = int(seconds // 60)
    secs = seconds % 60
    if minutes > 0:
        return f"{minutes}:{secs:04.1f}"
    return f"{secs:.1f}s"
