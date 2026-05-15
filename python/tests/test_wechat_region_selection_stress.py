import argparse
import html
import random
import sys
import unittest
from contextlib import contextmanager
from unittest.mock import patch
from pathlib import Path

from playwright.sync_api import sync_playwright


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
PUBLISH_ROOT = PYTHON_ROOT / "publish"
for candidate in (PROJECT_ROOT, PYTHON_ROOT, PUBLISH_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

import wechat_channels_rpa  # noqa: E402


STRESS_VARIANTS = [
    "custom_main",
    "custom_iframe",
    "native_select",
    "delayed_option",
    "already_selected",
    "visible_option_not_selected",
    "wechat_position_display",
    "wechat_position_visible_option",
    "wechat_position_selected",
]


@contextmanager
def fast_region_timeouts():
    original = {
        "REGION_SELECTION_TIMEOUT_SECONDS": wechat_channels_rpa.REGION_SELECTION_TIMEOUT_SECONDS,
        "REGION_SELECTION_MAX_ATTEMPTS": wechat_channels_rpa.REGION_SELECTION_MAX_ATTEMPTS,
        "REGION_TRIGGER_TIMEOUT_MS": wechat_channels_rpa.REGION_TRIGGER_TIMEOUT_MS,
        "REGION_OPTION_TIMEOUT_MS": wechat_channels_rpa.REGION_OPTION_TIMEOUT_MS,
    }
    wechat_channels_rpa.REGION_SELECTION_TIMEOUT_SECONDS = 4
    wechat_channels_rpa.REGION_SELECTION_MAX_ATTEMPTS = 3
    wechat_channels_rpa.REGION_TRIGGER_TIMEOUT_MS = 350
    wechat_channels_rpa.REGION_OPTION_TIMEOUT_MS = 250
    try:
        yield
    finally:
        for key, value in original.items():
            setattr(wechat_channels_rpa, key, value)


def base_document(body: str) -> str:
    return f"""
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{ font-family: sans-serif; padding: 24px; }}
    .form-item {{ margin: 16px 0; }}
    .form-item-body, .region-trigger, .ant-select-selector {{ border: 1px solid #bbb; padding: 8px; width: 260px; }}
  .menu {{ margin-top: 8px; border: 1px solid #999; width: 260px; }}
  .hidden {{ display: none; }}
  .ant-select-item-option, .weui-desktop-dropdown__list-item {{ padding: 8px; cursor: pointer; }}
  .selected {{ font-weight: 700; }}
  </style>
</head>
<body data-region-selected="false">
{body}
</body>
</html>
"""


def custom_region_body(*, delayed: bool = False, visible: bool = False, selected: bool = False) -> str:
    selected_text = "不展示地区" if selected else "成都市"
    menu_class = "" if visible else "hidden"
    delay_ms = 180 if delayed else 0
    return f"""
<div class="form-item">
  <label>位置</label>
  <div class="form-item-body">
    <button type="button" class="region-trigger">{selected_text}</button>
  </div>
</div>
<div class="menu {menu_class}" role="listbox">
  <div class="ant-select-item-option {'selected' if selected else ''}" role="option" aria-selected="{'true' if selected else 'false'}">不展示地区</div>
  <div class="ant-select-item-option" role="option">成都市</div>
</div>
<script>
(() => {{
  document.body.dataset.regionSelected = {str(selected).lower()} ? 'true' : 'false';
  const menu = document.querySelector('.menu');
  const trigger = document.querySelector('.region-trigger');
  const option = document.querySelector('[role="option"]');
  const openMenu = () => {{
    setTimeout(() => menu.classList.remove('hidden'), {delay_ms});
  }};
  trigger.addEventListener('click', openMenu);
  document.querySelector('.form-item-body').addEventListener('click', openMenu);
  option.addEventListener('click', () => {{
    document.body.dataset.regionSelected = 'true';
    trigger.textContent = '不展示地区';
    menu.classList.add('hidden');
  }});
}})();
</script>
"""


def wechat_position_display_body(*, visible: bool = False, selected: bool = False) -> str:
    selected_text = "不显示位置" if selected else "选择位置"
    menu_display = "block" if visible else "none"
    return f"""
<div class="form-item">
  <div class="label">位置</div>
  <div class="form-hdhd">
    <div class="post-position-wrap">
      <div class="position-display">
        <div class="position-display-wrap">{selected_text}</div>
      </div>
      <div class="location-filter-wrap" style="display: {menu_display};">
        <div class="location-item">不显示位置</div>
        <div class="location-item">上海市</div>
      </div>
    </div>
  </div>
</div>
<script>
(() => {{
  document.body.dataset.regionSelected = {str(selected).lower()} ? 'true' : 'false';
  const display = document.querySelector('.position-display');
  const current = document.querySelector('.position-display-wrap');
  const menu = document.querySelector('.location-filter-wrap');
  const option = document.querySelector('.location-item');
  const openMenu = () => {{
    menu.style.display = 'block';
  }};
  display.addEventListener('click', openMenu);
  document.querySelector('.post-position-wrap').addEventListener('click', openMenu);
  option.addEventListener('click', (event) => {{
    event.stopPropagation();
    document.body.dataset.regionSelected = 'true';
    current.textContent = '不显示位置';
    menu.style.display = 'none';
  }});
}})();
</script>
"""


def build_html(variant: str) -> str:
    if variant == "custom_main":
        return base_document(custom_region_body())
    if variant == "delayed_option":
        return base_document(custom_region_body(delayed=True))
    if variant == "already_selected":
        return base_document(custom_region_body(selected=True))
    if variant == "visible_option_not_selected":
        return base_document(custom_region_body(visible=True))
    if variant == "native_select":
        return base_document("""
<label>位置</label>
<select id="region">
  <option>成都市</option>
  <option>不展示地区</option>
</select>
<script>
(() => {
  document.getElementById('region').addEventListener('change', (event) => {
    document.body.dataset.regionSelected = event.target.value === '不展示地区' ? 'true' : 'false';
  });
})();
</script>
""")
    if variant == "wechat_position_display":
        return base_document(wechat_position_display_body())
    if variant == "wechat_position_visible_option":
        return base_document(wechat_position_display_body(visible=True))
    if variant == "wechat_position_selected":
        return base_document(wechat_position_display_body(selected=True))
    if variant == "custom_iframe":
        srcdoc = html.escape(base_document(custom_region_body()), quote=True)
        return base_document(f'<iframe style="width: 600px; height: 420px" srcdoc="{srcdoc}"></iframe>')
    raise ValueError(f"Unknown variant: {variant}")


def region_selected(page) -> bool:
    selected = page.evaluate("document.body.dataset.regionSelected === 'true'")
    if selected:
        return True
    for frame in page.frames:
        try:
            if frame.evaluate("document.body.dataset.regionSelected === 'true'"):
                return True
        except Exception:
            continue
    return False


def run_region_selection_stress(*, runs: int = 60, seed: int = 42) -> dict:
    rng = random.Random(seed)
    results = []
    with fast_region_timeouts(), \
         patch.object(wechat_channels_rpa, "emit_progress"), \
         patch.object(wechat_channels_rpa, "log"), \
         sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            variants = list(STRESS_VARIANTS)
            while len(variants) < runs:
                variants.append(rng.choice(STRESS_VARIANTS))
            rng.shuffle(variants)
            for index in range(runs):
                variant = variants[index]
                page.set_content(build_html(variant), wait_until="domcontentloaded")
                page.wait_for_timeout(20)
                started = wechat_channels_rpa.time.time()
                wechat_channels_rpa.select_no_region(page)
                elapsed_ms = int((wechat_channels_rpa.time.time() - started) * 1000)
                success = region_selected(page)
                results.append({
                    "index": index + 1,
                    "variant": variant,
                    "success": success,
                    "elapsed_ms": elapsed_ms,
                })
        finally:
            browser.close()

    failures = [item for item in results if not item["success"]]
    by_variant = {}
    for item in results:
        stats = by_variant.setdefault(item["variant"], {"runs": 0, "failures": 0})
        stats["runs"] += 1
        if not item["success"]:
            stats["failures"] += 1
    return {
        "runs": runs,
        "seed": seed,
        "successes": runs - len(failures),
        "failures": failures,
        "by_variant": by_variant,
    }


class WechatRegionSelectionStressTest(unittest.TestCase):
    def test_region_selection_stress_success_rate(self):
        result = run_region_selection_stress(runs=60, seed=20260512)
        if result["failures"]:
            summary = ", ".join(
                f"{name}: {stats['failures']}/{stats['runs']}"
                for name, stats in sorted(result["by_variant"].items())
                if stats["failures"]
            )
            self.fail(f"region selection stress failures: {summary}; first failures={result['failures'][:5]}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Stress-test WeChat no-region selection against local DOM variants.")
    parser.add_argument("--runs", type=int, default=60)
    parser.add_argument("--seed", type=int, default=20260512)
    args = parser.parse_args()

    result = run_region_selection_stress(runs=args.runs, seed=args.seed)
    print(f"runs={result['runs']} seed={result['seed']} successes={result['successes']} failures={len(result['failures'])}")
    for name, stats in sorted(result["by_variant"].items()):
        passed = stats["runs"] - stats["failures"]
        print(f"{name}: {passed}/{stats['runs']} passed")
    if result["failures"]:
        print("first failures:")
        for item in result["failures"][:10]:
            print(item)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
