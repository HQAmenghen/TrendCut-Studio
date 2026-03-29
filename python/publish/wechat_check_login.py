import os
import sys
import json
import time
import argparse
from playwright.sync_api import sync_playwright

def ulog(msg: str):
    print(f"WECHAT_LOGIN_CHECK|{msg}", flush=True)

def is_on_login_page(url: str) -> bool:
    return "channels.weixin.qq.com" in url and "/login" in url

def is_on_dashboard(url: str) -> bool:
    return "channels.weixin.qq.com/platform" in url and "/login" not in url

def check_any_page_dashboard(browser) -> bool:
    """Check ALL pages/tabs for dashboard URL."""
    try:
        for page in browser.pages:
            url = page.url or ""
            if is_on_dashboard(url):
                ulog(f"Dashboard detected: {url[:120]}")
                return True
    except Exception as e:
        ulog(f"Page check error: {e}")
    return False

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-data-dir", required=True)
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--wait-after-qr-seconds", type=int, default=180)
    args = parser.parse_args()

    user_data_dir = os.path.abspath(args.user_data_dir)
    os.makedirs(user_data_dir, exist_ok=True)
    ulog(f"Starting login check for {args.account_id} (headed)")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch_persistent_context(
                user_data_dir=user_data_dir,
                headless=False,
                viewport={"width": 1280, "height": 800},
                args=["--disable-blink-features=AutomationControlled"]
            )
            page = browser.pages[0] if browser.pages else browser.new_page()

            # Navigate to /platform (NOT /login) — let the server decide
            # If logged in: stays on /platform (dashboard)
            # If not logged in: server redirects to /platform/login (shows QR)
            ulog("Navigating to channels platform...")
            try:
                page.goto("https://channels.weixin.qq.com/platform", wait_until="domcontentloaded", timeout=45000)
            except Exception as e:
                ulog(f"Navigation warning (may be normal): {e}")

            # Wait a moment for any client-side redirects to settle
            time.sleep(3)

            # Log all page URLs for diagnostics
            for idx, pg in enumerate(browser.pages):
                try:
                    ulog(f"  page[{idx}] url={pg.url[:120]}")
                except Exception:
                    pass

            # Check: are we on dashboard or login page?
            if check_any_page_dashboard(browser):
                ulog("Already logged in — session cookies are valid!")
                print(json.dumps({"success": True, "status": "logged_in"}), flush=True)
                time.sleep(2)
                browser.close()
                return

            # We ended up on the login page — need QR scan
            ulog("On login page — QR scan needed")
            print(json.dumps({
                "success": True,
                "status": "need_scan",
                "qrCodeBase64": "",
                "message": "请在弹出的浏览器窗口中扫描二维码"
            }), flush=True)

            # Wait for user to scan and confirm
            timeout_sec = max(120, int(args.wait_after_qr_seconds))
            deadline = time.time() + timeout_sec
            check_count = 0

            while time.time() < deadline:
                time.sleep(2)
                check_count += 1

                # Periodic diagnostics
                if check_count % 5 == 0:
                    for idx, pg in enumerate(browser.pages):
                        try:
                            ulog(f"  [poll #{check_count}] page[{idx}] url={pg.url[:120]}")
                        except Exception:
                            pass

                if check_any_page_dashboard(browser):
                    ulog("Login success detected!")
                    print(json.dumps({"success": True, "status": "logged_in"}), flush=True)
                    time.sleep(5)
                    browser.close()
                    return

            # Timed out
            ulog("Login check timed out")
            print(json.dumps({
                "success": False,
                "status": "expired",
                "error": f"登录超时（{timeout_sec}s），请重新点击扫码"
            }), flush=True)
            browser.close()

    except Exception as e:
        ulog(f"Fatal error: {e}")
        print(json.dumps({"success": False, "error": str(e)}), flush=True)

if __name__ == "__main__":
    main()
