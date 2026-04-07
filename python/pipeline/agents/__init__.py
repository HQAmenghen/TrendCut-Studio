"""
Pipeline Agents Module
轻量级 Agent 分工模块，用于数字人视频合成链路
"""

__version__ = "1.0.0"

# 导出主要模块
from . import utils
from . import schemas
from . import prompts

__all__ = ['utils', 'schemas', 'prompts']
