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

import wechat_channels_rpa  # noqa: E402


class FakeKeyboard:
    def __init__(self):
        self.pressed = []

    def press(self, key):
        self.pressed.append(key)


class FakeMouse:
    def __init__(self):
        self.clicks = []

    def click(self, x, y):
        self.clicks.append((x, y))


class FakePage:
    def __init__(self):
        self.keyboard = FakeKeyboard()
        self.mouse = FakeMouse()
        self.waits = []

    def wait_for_timeout(self, ms):
        self.waits.append(ms)


class WechatRegionSelectionTest(unittest.TestCase):
    def test_region_selection_is_bounded_and_dismisses_popovers_when_not_found(self):
        page = FakePage()
        monotonic_times = iter([0, 1, 2, 20])

        with patch.object(wechat_channels_rpa, "REGION_SELECTION_MAX_ATTEMPTS", 1), \
             patch.object(wechat_channels_rpa, "REGION_SELECTION_TIMEOUT_SECONDS", 3), \
             patch.object(wechat_channels_rpa, "_visible_no_region_text", return_value=""), \
             patch.object(wechat_channels_rpa, "_try_select_native_region_dropdown", return_value=False), \
             patch.object(wechat_channels_rpa, "_click_first_visible_in_contexts", return_value=(None, None, None)), \
             patch.object(wechat_channels_rpa, "_open_region_dropdown_by_dom", return_value=False), \
             patch.object(wechat_channels_rpa, "_open_location_field_by_label", return_value=False), \
             patch.object(wechat_channels_rpa, "_scroll_region_search_area", return_value=False), \
             patch.object(wechat_channels_rpa.time, "time", side_effect=lambda: next(monotonic_times)), \
             patch.object(wechat_channels_rpa, "emit_progress"), \
             patch.object(wechat_channels_rpa, "log") as log:
            wechat_channels_rpa.select_no_region(page)

        self.assertIn("Escape", page.keyboard.pressed)
        self.assertIn((20, 20), page.mouse.clicks)
        self.assertTrue(any("跳过地区设置并继续发布流程" in call.args[0] for call in log.call_args_list))


if __name__ == "__main__":
    unittest.main()
