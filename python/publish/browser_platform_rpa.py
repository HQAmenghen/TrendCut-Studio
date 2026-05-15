import argparse
import json
import time
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright


LOGIN_MARKERS = [
    "登录",
    "扫码",
    "验证码",
    "手机号",
    "密码",
]

TITLE_SELECTORS = [
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
    '[contenteditable="true"][placeholder*="标题"]',
    '[aria-label*="标题"]',
]

DESCRIPTION_SELECTORS = [
    'textarea[placeholder*="描述"]',
    'textarea[placeholder*="正文"]',
    'textarea[placeholder*="文案"]',
    'textarea[placeholder*="分享"]',
    '[contenteditable="true"][placeholder*="描述"]',
    '[contenteditable="true"][placeholder*="正文"]',
    '[contenteditable="true"]',
]

PUBLISH_TEXTS = [
    "发布",
    "立即发布",
    "确认发布",
]


def clean_pipe_text(value: str) -> str:
    return str(value or "").replace("|", " ").replace("\n", " ").strip()


def emit(state: str, message: str, percent: int = 0, **extra) -> None:
    payload = {"percent": percent, **extra}
    print(
        f"STATUS|{clean_pipe_text(state)}|platform|{clean_pipe_text(message)}|"
        f"{json.dumps(payload, ensure_ascii=False)}",
        flush=True,
    )


def log(message: str) -> None:
    print(f"LOG|{clean_pipe_text(message)}", flush=True)


def load_payload(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as file:
        payload = json.load(file)
    return payload if isinstance(payload, dict) else {}


def body_text(page, max_chars: int = 1800) -> str:
    try:
        return page.evaluate(
            "(limit) => String(document.body?.innerText || '').slice(0, limit)",
            max_chars,
        )
    except Exception:
        return ""


def looks_like_login_page(page) -> bool:
    text = body_text(page)
    if not text:
        return False
    return any(marker in text for marker in LOGIN_MARKERS)


def set_file_input(page, video_path: str) -> bool:
    selectors = [
        'input[type="file"][accept*="video"]',
        'input[type="file"]',
    ]
    for selector in selectors:
        try:
            locator = page.locator(selector)
            count = locator.count()
            for index in range(min(count, 6)):
                candidate = locator.nth(index)
                candidate.set_input_files(video_path, timeout=3000)
                log(f"已通过文件输入框上传视频: {selector}[{index}]")
                return True
        except Exception:
            continue
    return False


def fill_by_selector(page, selectors: list[str], value: str, label: str) -> bool:
    if not value:
        return False
    for selector in selectors:
        try:
            locator = page.locator(selector)
            count = locator.count()
            for index in range(min(count, 8)):
                candidate = locator.nth(index)
                try:
                    candidate.wait_for(state="visible", timeout=1200)
                    candidate.click(timeout=1200)
                    candidate.fill(value, timeout=1600)
                    log(f"已填写{label}: {selector}[{index}]")
                    return True
                except Exception:
                    try:
                        candidate.evaluate(
                            """(el, text) => {
                                if (!el) return;
                                if (el.isContentEditable) {
                                    el.innerText = text;
                                } else {
                                    el.value = text;
                                }
                                el.dispatchEvent(new Event('input', { bubbles: true }));
                                el.dispatchEvent(new Event('change', { bubbles: true }));
                            }""",
                            value,
                        )
                        log(f"已通过 DOM 填写{label}: {selector}[{index}]")
                        return True
                    except Exception:
                        continue
        except Exception:
            continue
    return False


def click_publish_button(page) -> bool:
    for text in PUBLISH_TEXTS:
        selectors = [
            f'button:has-text("{text}")',
            f'[role="button"]:has-text("{text}")',
            f'text={text}',
        ]
        for selector in selectors:
            try:
                locator = page.locator(selector)
                count = locator.count()
                for index in range(min(count, 6)):
                    candidate = locator.nth(index)
                    try:
                        candidate.wait_for(state="visible", timeout=1200)
                        candidate.click(timeout=1600)
                        log(f"已点击发布按钮: {selector}[{index}]")
                        return True
                    except Exception:
                        continue
            except Exception:
                continue
    return False


def wait_for_manual_close(browser) -> None:
    emit("ready_for_manual_publish", "浏览器已保持打开，请人工确认页面状态后关闭窗口", 100)
    while len(browser.pages) > 0:
        time.sleep(5)


def main() -> int:
    parser = argparse.ArgumentParser(description="Browser RPA for creator platforms")
    parser.add_argument("--payload", required=True, help="Payload json path")
    args = parser.parse_args()

    payload = load_payload(Path(args.payload))
    platform_label = str(payload.get("platformLabel") or payload.get("platform") or "平台")
    upload_url = str(payload.get("uploadUrl") or "").strip()
    user_data_dir = Path(payload.get("userDataDir") or "").resolve()
    video_path = Path(payload.get("videoPath") or "").resolve()
    publish_mode = str(payload.get("publishMode") or "draft").strip()
    title = str(payload.get("title") or "").strip()
    description = str(payload.get("description") or "").strip()
    tags = [str(item).strip() for item in payload.get("tags") or [] if str(item).strip()]

    if not upload_url:
        raise ValueError("Missing uploadUrl")
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    user_data_dir.mkdir(parents=True, exist_ok=True)
    emit("starting", f"正在准备{platform_label}浏览器自动化", 3)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch_persistent_context(
            str(user_data_dir),
            headless=bool(payload.get("headless", False)),
            viewport={"width": 1440, "height": 960},
            accept_downloads=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = browser.pages[0] if browser.pages else browser.new_page()
        try:
            emit("navigating", f"正在打开{platform_label}发布页", 12)
            try:
                page.goto(upload_url, timeout=30000, wait_until="domcontentloaded")
            except PlaywrightTimeoutError:
                log(f"{platform_label}发布页加载超时，继续尝试识别当前页面")
            page.wait_for_timeout(2500)

            if looks_like_login_page(page):
                emit("need_login", f"{platform_label}需要登录，请在浏览器中完成登录后继续", 20)

            emit("uploading", f"正在尝试上传{platform_label}视频", 48)
            uploaded = set_file_input(page, str(video_path))
            if not uploaded:
                log(f"未识别到{platform_label}上传控件，浏览器已打开供人工接管")
                wait_for_manual_close(browser)
                return 0

            page.wait_for_timeout(2500)
            emit("uploaded", f"{platform_label}视频已提交到页面，开始填写文案", 64)
            fill_by_selector(page, TITLE_SELECTORS, title, "标题")
            final_description = description
            if tags:
                final_description = f"{final_description}\n\n" + " ".join(f"#{tag}" for tag in tags)
            fill_by_selector(page, DESCRIPTION_SELECTORS, final_description.strip(), "描述")
            emit("edited", f"{platform_label}发布信息已填写", 88)

            if publish_mode == "publish":
                emit("publishing", f"正在尝试点击{platform_label}发布按钮", 94)
                if click_publish_button(page):
                    page.wait_for_timeout(3000)
                    emit("success", f"{platform_label}已提交发布操作，请在平台后台核验结果", 100)
                    return 0
                log(f"未能自动点击{platform_label}发布按钮，转为人工确认")

            wait_for_manual_close(browser)
            return 0
        finally:
            try:
                browser.close()
            except Exception:
                pass


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        emit("failed", str(exc), 100)
        raise
