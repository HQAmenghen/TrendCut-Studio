import argparse
import json
import time
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright


CONTENT_MANAGER_URL = "https://channels.weixin.qq.com/platform/post/list"
CONTENT_MANAGER_GOTO_TIMEOUT_MS = 15000


def is_login_page(page) -> bool:
    url = page.url or ""
    if "channels.weixin.qq.com" in url and ("/login" in url or "login.html" in url):
        return True
    try:
        text = page.evaluate("() => document.body.innerText.substring(0, 1200)")
        return any(
            marker in (text or "")
            for marker in ["扫码登录", "二维码登录", "请使用微信扫码", "一站式服务", "让创作更简单"]
        )
    except Exception:
        return False


def has_content_manager_ui(page) -> bool:
    url = page.url or ""
    if "channels.weixin.qq.com/platform/post/list" in url:
        return True
    try:
        text = page.evaluate("() => document.body.innerText.substring(0, 1600)")
        return any(
            marker in (text or "")
            for marker in ["内容管理", "已发表", "发表记录", "视频管理", "作品管理"]
        )
    except Exception:
        return False


def active_pages(browser):
    try:
        pages = list(browser.pages)
    except Exception:
        return []
    active = []
    for page in pages:
        try:
            if not page.is_closed():
                active.append(page)
        except Exception:
            continue
    return active


def wait_for_browser_close(browser, poll_interval=0.5) -> None:
    while active_pages(browser):
        time.sleep(poll_interval)


def main():
    parser = argparse.ArgumentParser(description="Open WeChat Channels content manager")
    parser.add_argument("--user-data-dir", required=True, help="Path to browser profile")
    parser.add_argument("--account-id", required=True)
    args = parser.parse_args()

    user_data_dir = Path(args.user_data_dir)
    user_data_dir.mkdir(parents=True, exist_ok=True)

    print(f"CONTENT_MANAGER|STARTING|{args.account_id}", flush=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch_persistent_context(
            str(user_data_dir),
            headless=False,
            viewport={"width": 1280, "height": 800},
            accept_downloads=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = browser.pages[0] if browser.pages else browser.new_page()
        try:
            navigation_error = None
            navigation_timed_out = False
            try:
                page.goto(
                    CONTENT_MANAGER_URL,
                    timeout=CONTENT_MANAGER_GOTO_TIMEOUT_MS,
                    wait_until="domcontentloaded",
                )
            except PlaywrightTimeoutError:
                navigation_timed_out = True
                print(f"CONTENT_MANAGER|GOTO_TIMEOUT|{page.url}", flush=True)
            except Exception as err:
                navigation_error = err
                print(f"CONTENT_MANAGER|WARN|navigation_error|{err}", flush=True)
            time.sleep(3)
            if is_login_page(page):
                print(json.dumps({
                    "success": False,
                    "status": "need_login",
                    "error": "账号未登录或登录态已失效，请先扫码登录"
                }, ensure_ascii=False), flush=True)
                browser.close()
                return
            if not has_content_manager_ui(page):
                print(f"CONTENT_MANAGER|WARN|unconfirmed_ui|{page.url}", flush=True)
                current_url = page.url or ""
                if (navigation_error or navigation_timed_out) and "channels.weixin.qq.com" not in current_url:
                    print(json.dumps({
                        "success": False,
                        "status": "navigation_failed",
                        "error": f"内容管理页打开失败，当前页面: {current_url or 'about:blank'}"
                    }, ensure_ascii=False), flush=True)
                    browser.close()
                    return
            print(f"CONTENT_MANAGER|READY|{page.url or CONTENT_MANAGER_URL}", flush=True)
            wait_for_browser_close(browser)
        finally:
            try:
                browser.close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
