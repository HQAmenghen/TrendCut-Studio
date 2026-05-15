import sys
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
PUBLISH_ROOT = PYTHON_ROOT / "publish"
for candidate in (PROJECT_ROOT, PYTHON_ROOT, PUBLISH_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

import browser_platform_rpa  # noqa: E402


class FakeLocator:
    def __init__(self, visible=True):
        self.visible = visible
        self.clicked = False
        self.files = []

    def count(self):
        return 1

    def nth(self, _index):
        return self

    def wait_for(self, **_kwargs):
        if not self.visible:
            raise RuntimeError("not visible")

    def click(self, **_kwargs):
        if not self.visible:
            raise RuntimeError("not visible")
        self.clicked = True

    def set_input_files(self, value, **_kwargs):
        self.files.append(value)


class FakePage:
    def __init__(self, locators=None):
        self.locators = locators or {}
        self.waits = []
        self.reloads = 0

    def locator(self, selector):
        locator = self.locators.get(selector)
        if locator is None:
            raise RuntimeError(f"missing selector: {selector}")
        return locator

    def wait_for_timeout(self, ms):
        self.waits.append(ms)

    def reload(self, **_kwargs):
        self.reloads += 1


class BrowserPlatformRpaTest(unittest.TestCase):
    def test_douyin_strategy_uses_douyin_specific_selectors(self):
        strategy = browser_platform_rpa.get_strategy("douyin")

        self.assertTrue(any("作品标题" in selector for selector in strategy["title_selectors"]))
        self.assertTrue(any("作品简介" in selector for selector in strategy["description_selectors"]))
        self.assertIn("立即发布", strategy["publish_texts"])

    def test_xiaohongshu_strategy_uses_xhs_specific_selectors(self):
        strategy = browser_platform_rpa.get_strategy("xiaohongshu")

        self.assertTrue(any("填写标题" in selector for selector in strategy["title_selectors"]))
        self.assertTrue(any("添加正文" in selector for selector in strategy["description_selectors"]))
        self.assertIn("提交发布", strategy["publish_texts"])

    def test_upload_video_clicks_upload_entry_before_retrying_file_input(self):
        file_input = FakeLocator()
        upload_button = FakeLocator()
        page = FakePage({'button:has-text("上传视频")': upload_button})

        with patch.object(browser_platform_rpa, "set_file_input", side_effect=[False, True]) as set_file_input:
            uploaded = browser_platform_rpa.upload_video(page, "C:/tmp/video.mp4")

        self.assertTrue(uploaded)
        self.assertTrue(upload_button.clicked)
        self.assertEqual(set_file_input.call_count, 2)

    def test_wait_for_login_does_not_reload_while_user_is_logging_in(self):
        page = FakePage()
        login_states = iter([True, False])

        with patch.object(browser_platform_rpa, "looks_like_login_page", side_effect=lambda _page: next(login_states)), \
             patch.object(browser_platform_rpa.time, "time", side_effect=[0, 1]), \
             patch.object(browser_platform_rpa, "emit") as emit:
            result = browser_platform_rpa.wait_for_login_if_needed(page, "抖音", 30)

        self.assertTrue(result)
        self.assertEqual(page.reloads, 0)
        emitted_states = [call.args[0] for call in emit.call_args_list]
        self.assertEqual(emitted_states, ["need_login", "login_ready"])


if __name__ == "__main__":
    unittest.main()
