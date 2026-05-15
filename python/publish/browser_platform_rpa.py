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

COMMON_TITLE_SELECTORS = [
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
    '[contenteditable="true"][placeholder*="标题"]',
    '[aria-label*="标题"]',
]

COMMON_DESCRIPTION_SELECTORS = [
    'textarea[placeholder*="描述"]',
    'textarea[placeholder*="正文"]',
    'textarea[placeholder*="文案"]',
    'textarea[placeholder*="分享"]',
    '[contenteditable="true"][placeholder*="描述"]',
    '[contenteditable="true"][placeholder*="正文"]',
    '[contenteditable="true"]',
]

PLATFORM_STRATEGIES = {
    "douyin": {
        "title_selectors": [
            'input[placeholder*="作品标题"]',
            'input[placeholder*="填写作品标题"]',
            '[contenteditable="true"]:near(:text("作品标题"))',
            *COMMON_TITLE_SELECTORS,
        ],
        "description_selectors": [
            'textarea[placeholder*="添加作品简介"]',
            'textarea[placeholder*="作品简介"]',
            'textarea[placeholder*="添加描述"]',
            '[contenteditable="true"][data-placeholder*="添加作品简介"]',
            '[contenteditable="true"][data-placeholder*="描述"]',
            *COMMON_DESCRIPTION_SELECTORS,
        ],
        "publish_texts": ["发布", "立即发布", "确认发布"],
    },
    "xiaohongshu": {
        "title_selectors": [
            'input[placeholder*="填写标题"]',
            'input[placeholder*="请输入标题"]',
            'textarea[placeholder*="标题"]',
            *COMMON_TITLE_SELECTORS,
        ],
        "description_selectors": [
            'textarea[placeholder*="添加正文"]',
            'textarea[placeholder*="填写正文"]',
            'textarea[placeholder*="这一刻的想法"]',
            '[contenteditable="true"][data-placeholder*="添加正文"]',
            '[contenteditable="true"][placeholder*="添加正文"]',
            *COMMON_DESCRIPTION_SELECTORS,
        ],
        "publish_texts": ["发布", "立即发布", "提交发布"],
    },
}

DEFAULT_STRATEGY = {
    "title_selectors": COMMON_TITLE_SELECTORS,
    "description_selectors": COMMON_DESCRIPTION_SELECTORS,
    "publish_texts": ["发布", "立即发布", "确认发布"],
}


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


def get_strategy(platform: str) -> dict:
    return PLATFORM_STRATEGIES.get(str(platform or "").strip(), DEFAULT_STRATEGY)


def wait_for_login_if_needed(page, platform_label: str, timeout_sec: int) -> bool:
    if not looks_like_login_page(page):
        return True
    emit("need_login", f"{platform_label}需要登录，请在浏览器中完成登录", 20)
    deadline = time.time() + max(30, int(timeout_sec or 180))
    while time.time() < deadline:
        page.wait_for_timeout(3000)
        if not looks_like_login_page(page):
            emit("login_ready", f"{platform_label}登录状态已恢复，继续自动发布", 30)
            return True
    log(f"{platform_label}登录等待超时，浏览器保留供人工继续")
    return False


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


def click_upload_entry(page) -> bool:
    selectors = [
        'button:has-text("上传视频")',
        '[role="button"]:has-text("上传视频")',
        'button:has-text("上传")',
        '[role="button"]:has-text("上传")',
        'text=上传视频',
        'text=上传',
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
                    log(f"已点击上传入口: {selector}[{index}]")
                    page.wait_for_timeout(1200)
                    return True
                except Exception:
                    continue
        except Exception:
            continue
    return False


def upload_video(page, video_path: str) -> bool:
    if set_file_input(page, video_path):
        return True
    if click_upload_entry(page):
        return set_file_input(page, video_path)
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


def click_publish_button(page, publish_texts: list[str]) -> bool:
    for text in publish_texts:
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


def wait_for_manual_close(browser, message: str = "浏览器已保持打开，请人工确认页面状态后关闭窗口") -> None:
    emit("ready_for_manual_publish", message, 100)
    while len(browser.pages) > 0:
        time.sleep(5)


def main() -> int:
    parser = argparse.ArgumentParser(description="Browser RPA for creator platforms")
    parser.add_argument("--payload", required=True, help="Payload json path")
    args = parser.parse_args()

    payload = load_payload(Path(args.payload))
    platform = str(payload.get("platform") or "").strip()
    platform_label = str(payload.get("platformLabel") or payload.get("platform") or "平台")
    upload_url = str(payload.get("uploadUrl") or "").strip()
    user_data_dir = Path(payload.get("userDataDir") or "").resolve()
    video_path = Path(payload.get("videoPath") or "").resolve()
    publish_mode = str(payload.get("publishMode") or "draft").strip()
    title = str(payload.get("title") or "").strip()
    description = str(payload.get("description") or "").strip()
    tags = [str(item).strip() for item in payload.get("tags") or [] if str(item).strip()]
    login_timeout_sec = int(payload.get("loginTimeoutSec") or 180)
    strategy = get_strategy(platform)

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

            if not wait_for_login_if_needed(page, platform_label, login_timeout_sec):
                wait_for_manual_close(browser, f"{platform_label}登录等待超时，请人工完成登录与发布")
                return 0

            emit("uploading", f"正在尝试上传{platform_label}视频", 48)
            uploaded = upload_video(page, str(video_path))
            if not uploaded:
                log(f"未识别到{platform_label}上传控件，浏览器已打开供人工接管")
                wait_for_manual_close(browser, f"未识别到{platform_label}上传控件，请人工上传并确认")
                return 0

            page.wait_for_timeout(2500)
            emit("uploaded", f"{platform_label}视频已提交到页面，开始填写文案", 64)
            fill_by_selector(page, strategy["title_selectors"], title, "标题")
            final_description = description
            if tags:
                final_description = f"{final_description}\n\n" + " ".join(f"#{tag}" for tag in tags)
            fill_by_selector(page, strategy["description_selectors"], final_description.strip(), "描述")
            emit("edited", f"{platform_label}发布信息已填写", 88)

            if publish_mode == "publish":
                emit("publishing", f"正在尝试点击{platform_label}发布按钮", 94)
                if click_publish_button(page, strategy["publish_texts"]):
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
