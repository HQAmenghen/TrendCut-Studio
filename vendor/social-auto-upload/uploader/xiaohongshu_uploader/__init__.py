from pathlib import Path

from conf import RUNTIME_DIR

Path(RUNTIME_DIR / "cookies" / "xiaohongshu_uploader").mkdir(parents=True, exist_ok=True)
