import unittest
import os
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
for candidate in (PROJECT_ROOT, PYTHON_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

class VideoVlmVertexBackendTest(unittest.TestCase):
    def test_text_provider_vertex_does_not_move_video_vlm_off_qwen(self):
        env = os.environ.copy()
        env.update({
            "LLM_PROVIDER": "qwen",
            "TEXT_LLM_PROVIDER": "vertex",
            "QWEN_VL_MODEL": "qwen3-vl-flash",
            "GEMINI_MODEL": "gemini-3.1-pro-preview",
            "PYTHONPATH": str(PYTHON_ROOT),
        })
        script = (
            "from pipeline import video_vlm; "
            "print(video_vlm.get_vl_model())"
        )
        proc = subprocess.run(
            [sys.executable, "-c", script],
            cwd=str(PROJECT_ROOT),
            env=env,
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(proc.stdout.strip().splitlines()[-1], "qwen3-vl-flash")


if __name__ == "__main__":
    unittest.main()
