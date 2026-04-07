"""
任务协议示例 - 展示如何在 Python 脚本中使用任务协议

这个示例展示了如何让现有脚本同时支持：
1. 旧的命令行参数方式（向后兼容）
2. 新的任务协议方式（推荐）

使用方式：
1. 命令行参数方式（旧）：
   python script.py --input video.mp4 --output result.mp4

2. 任务协议方式（新）：
   python script.py --work-dir /path/to/work/dir
   脚本会读取 /path/to/work/dir/task.json 获取输入
   脚本会写入 /path/to/work/dir/result.json 或 failure.json
"""

import argparse
import os
import sys

# 添加 pipeline 目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from task_protocol import read_task_input, write_task_result, write_task_failure, get_artifact_path


def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(description='任务协议示例脚本')

    # 任务协议方式（推荐）
    parser.add_argument('--work-dir', type=str, help='工作目录（任务协议模式）')

    # 命令行参数方式（向后兼容）
    parser.add_argument('--input', type=str, help='输入文件路径')
    parser.add_argument('--output', type=str, help='输出文件路径')
    parser.add_argument('--title', type=str, help='标题')

    return parser.parse_args()


def get_task_input(args):
    """
    获取任务输入

    优先使用任务协议方式，回退到命令行参数方式
    """
    # 任务协议方式
    if args.work_dir:
        task_input = read_task_input(args.work_dir)
        if task_input:
            return {
                'mode': 'protocol',
                'task_id': task_input.get('taskId'),
                'work_dir': args.work_dir,
                'input': task_input.get('input', {}),
                'input_file': task_input.get('input', {}).get('inputFile'),
                'output_file': task_input.get('input', {}).get('outputFile'),
                'title': task_input.get('input', {}).get('title')
            }
        else:
            print('[Warning] --work-dir 指定但 task.json 不存在，回退到命令行参数模式', file=sys.stderr)

    # 命令行参数方式（向后兼容）
    return {
        'mode': 'legacy',
        'task_id': None,
        'work_dir': None,
        'input': {},
        'input_file': args.input,
        'output_file': args.output,
        'title': args.title
    }


def write_task_output(task_input, success, artifacts=None, metadata=None, error=None):
    """
    写入任务输出

    如果是任务协议模式，写入 result.json 或 failure.json
    如果是命令行参数模式，不写入（保持向后兼容）
    """
    if task_input['mode'] != 'protocol':
        return

    work_dir = task_input['work_dir']
    task_id = task_input['task_id']

    if success:
        write_task_result(work_dir, task_id, artifacts or {}, metadata or {})
    else:
        write_task_failure(
            work_dir,
            task_id,
            error.get('code', 'UNKNOWN_ERROR'),
            error.get('message', 'Unknown error'),
            error.get('stage', 'unknown'),
            error.get('details', '')
        )


def main():
    """主函数"""
    args = parse_args()
    task_input = get_task_input(args)

    print(f'[Info] 运行模式: {task_input["mode"]}')
    print(f'[Info] 任务 ID: {task_input["task_id"]}')
    print(f'[Info] 输入文件: {task_input["input_file"]}')
    print(f'[Info] 输出文件: {task_input["output_file"]}')
    print(f'[Info] 标题: {task_input["title"]}')

    try:
        # 模拟任务执行
        if not task_input['input_file']:
            raise ValueError('输入文件不能为空')

        # 执行实际任务逻辑...
        # result = process_video(task_input['input_file'], task_input['output_file'])

        # 模拟成功输出
        artifacts = {
            'video': task_input['output_file'] or 'output.mp4',
            'thumbnail': 'thumbnail.jpg'
        }
        metadata = {
            'duration': 30.5,
            'resolution': '1080x1920',
            'title': task_input['title'] or 'Untitled'
        }

        write_task_output(task_input, success=True, artifacts=artifacts, metadata=metadata)
        print('[Success] 任务完成')
        return 0

    except Exception as e:
        # 模拟失败输出
        error = {
            'code': 'PROCESSING_FAILED',
            'message': str(e),
            'stage': 'processing',
            'details': f'Error type: {type(e).__name__}'
        }

        write_task_output(task_input, success=False, error=error)
        print(f'[Error] 任务失败: {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
