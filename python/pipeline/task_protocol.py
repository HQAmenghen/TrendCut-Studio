"""
任务对象协议 - Python 端工具模块

统一 Node 和 Python 之间的任务通信格式，避免文件名耦合。
"""

import json
import os
from datetime import datetime
from typing import Dict, Any, Optional


def read_task_input(work_dir: str) -> Optional[Dict[str, Any]]:
    """
    读取任务输入文件

    Args:
        work_dir: 工作目录

    Returns:
        任务输入对象，不存在返回 None
    """
    task_path = os.path.join(work_dir, 'task.json')
    if not os.path.exists(task_path):
        return None

    try:
        with open(task_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def write_task_result(work_dir: str, task_id: str, artifacts: Dict[str, Any], metadata: Dict[str, Any] = None):
    """
    写入任务成功输出文件

    Args:
        work_dir: 工作目录
        task_id: 任务 ID
        artifacts: 产物清单（文件名映射）
        metadata: 元数据
    """
    result = {
        'taskId': task_id,
        'status': 'success',
        'artifacts': artifacts or {},
        'metadata': metadata or {},
        'completedAt': datetime.utcnow().isoformat() + 'Z'
    }

    result_path = os.path.join(work_dir, 'result.json')
    with open(result_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)


def write_task_failure(work_dir: str, task_id: str, error_code: str, error_message: str,
                       error_stage: str = 'unknown', error_details: str = ''):
    """
    写入任务失败输出文件

    Args:
        work_dir: 工作目录
        task_id: 任务 ID
        error_code: 错误码
        error_message: 错误消息
        error_stage: 错误阶段
        error_details: 错误详情
    """
    failure = {
        'taskId': task_id,
        'status': 'failed',
        'error': {
            'code': error_code,
            'message': error_message,
            'stage': error_stage,
            'details': error_details
        },
        'failedAt': datetime.utcnow().isoformat() + 'Z'
    }

    failure_path = os.path.join(work_dir, 'failure.json')
    with open(failure_path, 'w', encoding='utf-8') as f:
        json.dump(failure, f, indent=2, ensure_ascii=False)


def get_artifact_path(work_dir: str, artifact_name: str) -> str:
    """
    获取产物的绝对路径

    Args:
        work_dir: 工作目录
        artifact_name: 产物文件名（相对路径）

    Returns:
        产物的绝对路径
    """
    if os.path.isabs(artifact_name):
        return artifact_name
    return os.path.join(work_dir, artifact_name)
