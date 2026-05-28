import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
PUBLISH_ROOT = PYTHON_ROOT / "publish"
for candidate in (PROJECT_ROOT, PYTHON_ROOT, PUBLISH_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

import wechat_open_content_manager  # noqa: E402


class WechatOpenContentManagerTest(unittest.TestCase):
    def test_active_pages_ignores_closed_pages(self):
        class FakePage:
            def __init__(self, closed):
                self.closed = closed

            def is_closed(self):
                return self.closed

        class FakeBrowser:
            pages = [FakePage(True), FakePage(False)]

        active = wechat_open_content_manager.active_pages(FakeBrowser())

        self.assertEqual(len(active), 1)
        self.assertFalse(active[0].is_closed())


if __name__ == "__main__":
    unittest.main()
