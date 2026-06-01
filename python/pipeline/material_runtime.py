"""Runtime primitives for the material-driven pipeline."""
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path


class MaterialRuntimeMixin:
    """Subprocess, file, and logging helpers shared by material workflows."""

    def log(self, message: str, level: str = "info"):
        """日志输出"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        prefix = {
            "info": "ℹ️",
            "success": "✅",
            "warning": "⚠️",
            "error": "❌",
            "step": "📍",
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
            env = os.environ.copy()
            env["MATERIAL_REQUIRE_LLM_SCORING"] = "1" if self.require_llm else "0"
            result = subprocess.run(
                cmd,
                cwd=cwd or str(self.output_dir),
                capture_output=False,
                text=True,
                env=env,
            )
            if result.returncode == 0:
                self.log(f"{script_name} 完成", "success")
                return True
            self.log(f"{script_name} 失败 (返回码: {result.returncode})", "error")
            return False
        except Exception as e:
            self.log(f"{script_name} 执行异常: {e}", "error")
            return False

    def run_script_async(self, script_name: str, args: list = None, cwd: str = None):
        """异步运行 Python 脚本，返回 subprocess.Popen 对象。"""
        script_path = self.pipeline_dir / script_name
        if not script_path.exists():
            self.log(f"脚本不存在: {script_name}", "error")
            return None
        cmd = [sys.executable, str(script_path)]
        if args:
            cmd.extend(args)
        self.log(f"异步启动: {script_name}", "info")
        env = os.environ.copy()
        env["MATERIAL_REQUIRE_LLM_SCORING"] = "1" if self.require_llm else "0"
        return subprocess.Popen(
            cmd,
            cwd=cwd or str(self.output_dir),
            stdout=sys.stdout,
            stderr=sys.stderr,
            env=env,
        )

    def _run_script_async(self, script_name: str, args: list = None, cwd: str = None):
        return self.run_script_async(script_name, args=args, cwd=cwd)

    def check_file(self, file_path: Path, description: str) -> bool:
        """检查文件是否存在"""
        if file_path.exists():
            self.log(f"{description} 存在: {file_path.name}", "success")
            return True
        self.log(f"{description} 不存在: {file_path.name}", "warning")
        return False

    def has_cached_files(self, file_paths: list[Path]) -> bool:
        """检查一组缓存文件是否都存在。"""
        return all(Path(item).exists() for item in file_paths)

    def load_json_file(self, file_path: Path, default=None):
        """读取 JSON 文件，失败时返回默认值。"""
        if default is None:
            default = {}
        if not file_path.exists():
            return default
        try:
            return json.loads(file_path.read_text(encoding="utf-8"))
        except Exception:
            return default

    def save_json_file(self, file_path: Path, data) -> bool:
        """写入 JSON 文件。"""
        try:
            file_path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            return True
        except Exception:
            return False
