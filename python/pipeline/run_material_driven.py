#!/usr/bin/env python3
"""
素材驱动的数字人视频制作主控脚本
完整流程：素材分析 → 规划 → 生成数字人 → 智能混剪
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
import json
import argparse
import subprocess
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from script_protocol import emit_result, emit_stage


class MaterialDrivenPipeline:
    """素材驱动的视频制作流程"""

    def __init__(self, material_path: str, output_dir: str = "./", use_smart_clip: bool = True):
        self.material_path = Path(material_path)
        self.output_dir = Path(output_dir)
        self.use_smart_clip = use_smart_clip
        self.pipeline_dir = Path(__file__).parent

        # 确保输出目录存在
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # 工作文件
        self.material_file = self.output_dir / "material.mp4"
        self.audio_json = self.output_dir / "audio.json"
        self.result_json = self.output_dir / "result.json"
        self.segments_json = self.output_dir / "segments.json"
        self.director_json = self.output_dir / "director_final.json"
        self.narration_json = self.output_dir / "narration.json"
        self.aiman_file = self.output_dir / "aiman.mp4"
        self.output_file = self.output_dir / "output_final.mp4"

    def log(self, message: str, level: str = "info"):
        """日志输出"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        prefix = {
            "info": "ℹ️",
            "success": "✅",
            "warning": "⚠️",
            "error": "❌",
            "step": "📍"
        }.get(level, "ℹ️")
        print(f"[{timestamp}] {prefix} {message}")

    def run_script(self, script_name: str, args: list = None, cwd: str = None) -> bool:
        """运行Python脚本"""
        script_path = self.pipeline_dir / script_name
        if not script_path.exists():
            self.log(f"脚本不存在: {script_name}", "error")
            return False

        cmd = [sys.executable, str(script_path)]
        if args:
            cmd.extend(args)

        self.log(f"执行: {script_name}", "step")

        try:
            result = subprocess.run(
                cmd,
                cwd=cwd or str(self.output_dir),
                capture_output=False,
                text=True
            )
            if result.returncode == 0:
                self.log(f"{script_name} 完成", "success")
                return True
            else:
                self.log(f"{script_name} 失败 (返回码: {result.returncode})", "error")
                return False
        except Exception as e:
            self.log(f"{script_name} 执行异常: {e}", "error")
            return False

    def check_file(self, file_path: Path, description: str) -> bool:
        """检查文件是否存在"""
        if file_path.exists():
            self.log(f"{description} 存在: {file_path.name}", "success")
            return True
        else:
            self.log(f"{description} 不存在: {file_path.name}", "warning")
            return False

    def ensure_content_outline(self) -> bool:
        """确保 generate_narration.py 依赖的 content_outline.json 存在。"""
        outline_path = self.output_dir / "content_outline.json"
        if outline_path.exists():
            return True

        selected_segments = []
        selected_segments_path = self.output_dir / "selected_segments.json"
        if selected_segments_path.exists():
            try:
                selected_segments = json.loads(selected_segments_path.read_text(encoding="utf-8"))
            except Exception:
                selected_segments = []

        segments = []
        total_duration = 0.0
        for idx, item in enumerate(selected_segments if isinstance(selected_segments, list) else []):
            try:
                start = float(item.get("start_time", item.get("start", 0.0)))
                end = float(item.get("end_time", item.get("end", 0.0)))
            except Exception:
                start, end = 0.0, 0.0
            duration = max(0.0, end - start)
            total_duration += duration
            summary = str(
                item.get("summary")
                or item.get("text")
                or item.get("subtitle_text")
                or item.get("goal")
                or ""
            ).strip()
            if not summary:
                continue
            segments.append({
                "id": f"segment_{idx + 1}",
                "summary": summary,
                "goal": summary,
                "supporting_context": "",
                "start_time": round(start, 3),
                "end_time": round(end, 3),
                "duration_sec": round(duration, 3)
            })

        if not segments and self.audio_json.exists():
            try:
                audio_items = json.loads(self.audio_json.read_text(encoding="utf-8"))
            except Exception:
                audio_items = []
            if isinstance(audio_items, list):
                for idx, item in enumerate(audio_items[:8]):
                    text = " ".join(str(item.get("text", "")).split()).strip()
                    if not text:
                        continue
                    try:
                        start = float(item.get("start", 0.0))
                        end = float(item.get("end", start + 3.0))
                    except Exception:
                        start, end = 0.0, 3.0
                    duration = max(0.5, end - start)
                    total_duration += duration
                    segments.append({
                        "id": f"segment_{idx + 1}",
                        "summary": text,
                        "goal": text,
                        "supporting_context": "",
                        "start_time": round(start, 3),
                        "end_time": round(end, 3),
                        "duration_sec": round(duration, 3)
                    })

        if not segments:
            # 最低限兜底：避免出现模板腔，给中性引导语
            segments = [{
                "id": "segment_1",
                "summary": "先把素材里的关键信息讲清楚，再补充一句结论。",
                "goal": "输出自然、简洁、可直接配音的口播",
                "supporting_context": "",
                "start_time": 0.0,
                "end_time": 30.0,
                "duration_sec": 30.0
            }]
            total_duration = 30.0

        outline = {
            "topic": "素材驱动混剪",
            "title": "素材驱动混剪口播大纲",
            "summary": "根据素材分析结果自动生成",
            "source_duration_sec": round(total_duration, 3),
            "target_duration_sec": int(min(90, max(30, total_duration if total_duration > 0 else 45))),
            "segments": segments
        }

        try:
            outline_path.write_text(json.dumps(outline, ensure_ascii=False, indent=2), encoding="utf-8")
            self.log(f"已自动生成口播大纲: {outline_path.name}", "info")
            return True
        except Exception as e:
            self.log(f"生成口播大纲失败: {e}", "error")
            return False

    def step1_prepare_material(self) -> bool:
        """步骤1: 准备素材"""
        emit_stage("prepare", "准备素材文件")
        self.log("=" * 60, "step")
        self.log("步骤1: 准备素材", "step")
        self.log("=" * 60, "step")

        if not self.material_path.exists():
            self.log(f"素材文件不存在: {self.material_path}", "error")
            return False

        # 复制素材到工作目录
        import shutil
        source_path = self.material_path.resolve()
        target_path = self.material_file.resolve()
        if source_path == target_path:
            self.log(f"素材已在工作目录，跳过复制: {self.material_file}", "info")
        else:
            shutil.copy2(source_path, target_path)
            self.log(f"素材已复制到: {self.material_file}", "success")

        return True

    def step2_analyze_material(self) -> bool:
        """步骤2: 分析素材（ASR + VLM）"""
        emit_stage("analyze", "分析素材内容")
        self.log("=" * 60, "step")
        self.log("步骤2: 分析素材", "step")
        self.log("=" * 60, "step")

        # 2.1 音频识别 (ASR)
        self.log("2.1 提取音频并识别...", "info")
        if not self.run_script("run_asr.py", [
            "--input", str(self.material_file),
            "--allow-no-audio",
            "--audio-json", str(self.audio_json),
            "--subtitles-json", "subtitles.json",
            "--speaker-scene-json", "speaker_scene.json"
        ]):
            return False

        if not self.check_file(self.audio_json, "音频识别结果"):
            return False

        # 2.2 视觉分析 (VLM)
        self.log("2.2 分析视觉内容...", "info")
        if not self.run_script("video_vlm.py"):
            return False

        if not self.check_file(self.result_json, "视觉分析结果"):
            return False

        return True

    def step3_segment_material(self) -> bool:
        """步骤3: 素材切片和评分"""
        emit_stage("segment", "素材切片和评分")
        self.log("=" * 60, "step")
        self.log("步骤3: 素材切片", "step")
        self.log("=" * 60, "step")

        # 3.1 切片
        self.log("3.1 按语义切片...", "info")
        if not self.run_script("segment_material.py"):
            return False

        # 3.2 评分
        self.log("3.2 评分素材片段...", "info")
        if not self.run_script("score_material_segments.py"):
            return False

        # 3.3 选择
        self.log("3.3 选择优质片段...", "info")
        if not self.run_script("select_material_segments.py"):
            return False

        return True

    def step4_director_planning(self) -> bool:
        """步骤4: 导演规划（关键步骤）"""
        emit_stage("planning", "AI导演规划剪辑方案")
        self.log("=" * 60, "step")
        self.log("步骤4: 导演规划", "step")
        self.log("=" * 60, "step")

        self.log("AI导演正在规划...", "info")
        self.log("- 分析素材内容", "info")
        self.log("- 规划素材使用（70%）", "info")
        self.log("- 规划数字人位置（30%）", "info")
        self.log("- 确定解说词需求", "info")

        if not self.run_script("run_director.py"):
            return False

        # run_director.py 当前产出 director_raw.json，需要再做一次后处理得到 director_final.json
        director_raw_path = self.output_dir / "director_raw.json"
        if director_raw_path.exists():
            if not self.run_script("post_process_director.py", [
                "--input", str(director_raw_path),
                "--output", str(self.director_json)
            ]):
                return False

        if not self.check_file(self.director_json, "导演方案"):
            return False

        # 显示规划摘要
        try:
            with open(self.director_json, 'r', encoding='utf-8') as f:
                director_plan = json.load(f)

            total_duration = 0
            aiman_duration = 0
            material_duration = 0

            for shot in director_plan:
                duration = shot['end_time'] - shot['start_time']
                total_duration += duration

                if shot.get('video_source') == 'aiman.mp4':
                    aiman_duration += duration
                else:
                    material_duration += duration

            self.log(f"规划摘要:", "info")
            self.log(f"  总时长: {total_duration:.1f}秒", "info")
            self.log(f"  素材占比: {material_duration/total_duration*100:.1f}%", "info")
            self.log(f"  数字人占比: {aiman_duration/total_duration*100:.1f}%", "info")

        except Exception as e:
            self.log(f"读取规划失败: {e}", "warning")

        return True

    def step5_generate_narration(self) -> bool:
        """步骤5: 生成解说词"""
        emit_stage("narration", "生成数字人解说词")
        self.log("=" * 60, "step")
        self.log("步骤5: 生成解说词", "step")
        self.log("=" * 60, "step")

        self.log("根据规划生成解说词...", "info")

        if not self.ensure_content_outline():
            return False

        if not self.run_script("generate_narration.py", [
            "--outline", str(self.output_dir / "content_outline.json"),
            "--output", str(self.narration_json),
            "--text-output", str(self.output_dir / "narration.txt")
        ]):
            return False

        if not self.check_file(self.narration_json, "解说词"):
            return False

        # 显示解说词摘要
        try:
            with open(self.narration_json, 'r', encoding='utf-8') as f:
                narration = json.load(f)

            full_text = narration.get('full_text', '')
            target_duration = narration.get('target_duration_sec', 0)

            self.log(f"解说词摘要:", "info")
            self.log(f"  目标时长: {target_duration}秒", "info")
            self.log(f"  字数: {len(full_text)}字", "info")
            self.log(f"  预计语速: {len(full_text)/target_duration:.1f}字/秒", "info")

        except Exception as e:
            self.log(f"读取解说词失败: {e}", "warning")

        return True

    def step6_generate_avatar(self) -> bool:
        """步骤6: 生成数字人（需要ComfyUI）"""
        emit_stage("avatar", "生成数字人视频")
        self.log("=" * 60, "step")
        self.log("步骤6: 生成数字人", "step")
        self.log("=" * 60, "step")

        self.log("⚠️ 此步骤需要通过Node.js服务调用ComfyUI", "warning")
        self.log("请确保:", "info")
        self.log("  1. ComfyUI服务正在运行", "info")
        self.log("  2. 已配置COMFYUI_BASE_URL", "info")
        self.log("  3. 通过前端或API触发数字人生成", "info")

        # 等待aiman.mp4生成
        self.log("等待数字人视频生成...", "info")
        self.log(f"预期输出: {self.aiman_file}", "info")

        # 检查是否已存在
        if self.check_file(self.aiman_file, "数字人视频"):
            return True

        self.log("数字人视频未找到，请手动生成后继续", "warning")
        return False

    def step7_smart_mixing(self) -> bool:
        """步骤7: 智能混剪（使用SmartVideoComposer）"""
        emit_stage("mixing", "智能混剪合成")
        self.log("=" * 60, "step")
        self.log("步骤7: 智能混剪", "step")
        self.log("=" * 60, "step")

        # 检查必要文件
        if not self.check_file(self.aiman_file, "数字人视频"):
            self.log("缺少数字人视频，无法混剪", "error")
            return False

        if not self.check_file(self.material_file, "素材视频"):
            self.log("缺少素材视频，无法混剪", "error")
            return False

        if not self.check_file(self.director_json, "导演方案"):
            self.log("缺少导演方案，无法混剪", "error")
            return False

        # 使用SmartVideoComposer进行智能混剪
        try:
            from smart_video_composer import SmartVideoComposer

            self.log("初始化智能视频合成器", "info")
            composer = SmartVideoComposer(str(self.output_dir))

            if self.use_smart_clip:
                self.log("使用智能剪辑模式（OST策略 + 硬件加速 + 智能音频）", "info")
            else:
                self.log("使用基础剪辑模式", "info")

            success = composer.compose_from_director_plan(
                director_plan_path=str(self.director_json),
                material_video=str(self.material_file),
                aiman_video=str(self.aiman_file),
                output_path=str(self.output_file),
                use_smart_clip=self.use_smart_clip
            )

            if not success:
                self.log("智能混剪失败", "error")
                return False

        except Exception as e:
            self.log(f"智能混剪异常: {e}", "error")
            return False

        if not self.check_file(self.output_file, "最终视频"):
            return False

        return True

    def run(self, start_from: int = 1, end_at: int = 7) -> bool:
        """运行完整流程"""
        self.log("🚀 素材驱动的数字人视频制作流程", "step")
        self.log(f"素材: {self.material_path}", "info")
        self.log(f"输出: {self.output_dir}", "info")
        self.log(f"智能剪辑: {'启用' if self.use_smart_clip else '禁用'}", "info")

        steps = [
            (1, "准备素材", self.step1_prepare_material),
            (2, "分析素材", self.step2_analyze_material),
            (3, "素材切片", self.step3_segment_material),
            (4, "导演规划", self.step4_director_planning),
            (5, "生成解说词", self.step5_generate_narration),
            (6, "生成数字人", self.step6_generate_avatar),
            (7, "智能混剪", self.step7_smart_mixing),
        ]

        for step_num, step_name, step_func in steps:
            if step_num < start_from:
                continue
            if step_num > end_at:
                break

            try:
                if not step_func():
                    self.log(f"步骤{step_num}失败: {step_name}", "error")
                    return False
            except Exception as e:
                self.log(f"步骤{step_num}异常: {e}", "error")
                import traceback
                traceback.print_exc()
                return False

        self.log("=" * 60, "step")
        self.log("🎉 流程完成！", "success")
        self.log(f"最终视频: {self.output_file}", "success")
        self.log("=" * 60, "step")

        emit_result({"output": str(self.output_file)})
        return True


def main():
    parser = argparse.ArgumentParser(description="素材驱动的数字人视频制作")
    parser.add_argument("material", help="素材视频路径")
    parser.add_argument("--output-dir", "-o", default="./", help="输出目录")
    parser.add_argument("--no-smart-clip", action="store_true", help="禁用智能剪辑")
    parser.add_argument("--start-from", type=int, default=1, choices=range(1, 8),
                       help="从指定步骤开始 (1-7)")
    parser.add_argument("--end-at", type=int, default=7, choices=range(1, 8),
                       help="在指定步骤结束 (1-7)")

    args = parser.parse_args()

    pipeline = MaterialDrivenPipeline(
        material_path=args.material,
        output_dir=args.output_dir,
        use_smart_clip=not args.no_smart_clip
    )

    success = pipeline.run(start_from=args.start_from, end_at=args.end_at)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
