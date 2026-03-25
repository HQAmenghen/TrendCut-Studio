
import sys
import json
import re

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from script_protocol import emit_result, emit_stage, run_guarded

def srt_time_to_seconds(t):
    h, m, s, ms = map(int, re.match(r'(\d+):(\d+):(\d+),(\d+)', t).groups())
    return h * 3600 + m * 60 + s + ms / 1000

def main(srt_file, json_file):
    emit_stage("subtitle_conversion", "正在将 SRT 转换为 JSON")
    with open(srt_file, 'r', encoding='utf-8') as f:
        srt_content = f.read()
    
    segments = []
    blocks = srt_content.strip().split('\n\n')
    for block in blocks:
        lines = block.split('\n')
        if len(lines) >= 3:
            time_line = lines[1]
            text_lines = lines[2:]
            text = ' '.join(text_lines)
            
            start_t_str, end_t_str = time_line.split(' --> ')
            start_t = srt_time_to_seconds(start_t_str)
            end_t = srt_time_to_seconds(end_t_str)
            
            segments.append({"time": [start_t, end_t], "text": text})
            
    with open(json_file, 'w', encoding='utf-8') as f:
        json.dump(segments, f, ensure_ascii=False, indent=2)
    emit_result("SRT 转换完成", output=json_file, segments=len(segments))

if __name__ == '__main__':
    sys.exit(run_guarded(
        lambda: main(sys.argv[1], sys.argv[2]),
        error_code="SRT_CONVERSION_FAILED",
        error_message="SRT 转 JSON 失败",
        error_stage="subtitle_conversion",
        hint="请检查 SRT 文件内容和输出路径是否可写",
    ))
