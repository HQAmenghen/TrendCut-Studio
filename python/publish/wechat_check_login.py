import os
import sys
import json
import time
import base64
import argparse
from playwright.sync_api import sync_playwright

# 日志文件路径
LOG_FILE = os.path.join(os.getcwd(), "data", "logs", "wechat_login_check.log")

def ulog(msg: str):
    log_msg = f"WECHAT_LOGIN_CHECK|{msg}"
    print(log_msg, flush=True)
    # 同时写入日志文件
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
            f.write(f"[{timestamp}] {log_msg}\n")
    except Exception:
        pass  # 静默失败，不影响主流程

def is_on_login_page(url: str) -> bool:
    return "channels.weixin.qq.com" in url and ("/login" in url or "login.html" in url)

def is_on_dashboard(url: str) -> bool:
    # 更宽松的判断：只要是 channels.weixin.qq.com 且不是登录页面
    return "channels.weixin.qq.com" in url and "/login" not in url and "login.html" not in url

def close_stale_pages(browser, keep_page=None):
    for pg in list(browser.pages):
        if keep_page is not None and pg == keep_page:
            continue
        try:
            pg.close()
        except Exception:
            pass

def page_has_login_ui(page) -> bool:
    selectors = [
        "iframe[src*='login-for-iframe']",
        ".login-qrcode-wrap",
        ".qrcode-wrap",
        "img.qrcode",
        ".weui-desktop-login__main",
    ]
    try:
        for selector in selectors:
            if page.locator(selector).count() > 0:
                return True
    except Exception as e:
        ulog(f"Login UI check error: {e}")
    return False

def page_has_dashboard_ui(page) -> bool:
    selectors = [
        ".weui-desktop-layout__main__bd",
        ".weui-desktop-layout",
        ".post-create-container",
        "input[type='file']",
        ".finder-mention-topic",
        # 新增更多通用选择器
        ".weui-desktop-layout__hd",  # 顶部导航栏
        ".weui-desktop-layout__sidebar",  # 侧边栏
        "[class*='desktop-layout']",  # 任何包含 desktop-layout 的类
        "button[class*='post']",  # 发布相关按钮
        ".weui-desktop-global-navigation",  # 全局导航
    ]
    try:
        for selector in selectors:
            if page.locator(selector).count() > 0:
                return True
    except Exception as e:
        ulog(f"Dashboard UI check error: {e}")
    return False

def capture_qrcode(page) -> str:
    """捕获二维码图片并返回保存路径"""
    try:
        # 尝试多个可能的二维码选择器
        qr_selectors = [
            "img.qrcode",
            ".login-qrcode-wrap img",
            ".qrcode-wrap img",
            "img[src*='qrcode']",
            ".weui-desktop-login__main img",
            "iframe[src*='login-for-iframe']"
        ]

        qr_element = None
        found_selector = None

        # 尝试找到二维码元素
        for selector in qr_selectors:
            try:
                locator = page.locator(selector).first
                if locator.count() > 0:
                    qr_element = locator
                    found_selector = selector
                    ulog(f"Found QR code element with selector: {selector}")
                    break
            except Exception as e:
                continue

        if qr_element:
            # 等待二维码图片加载完成
            ulog("Waiting for QR code image to load...")
            time.sleep(3)  # 额外等待确保图片加载完成

            # 如果是 iframe，需要特殊处理
            if "iframe" in found_selector:
                ulog("QR code is in iframe, taking full page screenshot")
                page_path = os.path.join(os.getcwd(), "temp_qrcode.png")
                page.screenshot(path=page_path)
                ulog(f"Full page screenshot saved to: {page_path}")
                return page_path

            # 尝试截取二维码元素
            try:
                qr_path = os.path.join(os.getcwd(), "temp_qrcode.png")
                qr_element.screenshot(path=qr_path)
                ulog(f"QR code element screenshot saved to: {qr_path}")

                # 验证截图文件大小（如果太小可能是空白）
                import os as os_module
                if os_module.path.exists(qr_path):
                    file_size = os_module.path.getsize(qr_path)
                    if file_size < 1000:  # 小于 1KB 可能是空白
                        ulog(f"QR code screenshot too small ({file_size} bytes), taking full page screenshot")
                        page.screenshot(path=qr_path)
                        ulog(f"Full page screenshot saved to: {qr_path}")

                return qr_path
            except Exception as e:
                ulog(f"Failed to screenshot QR element: {e}, taking full page screenshot")
                page_path = os.path.join(os.getcwd(), "temp_qrcode.png")
                page.screenshot(path=page_path)
                ulog(f"Full page screenshot saved to: {page_path}")
                return page_path

        # 如果找不到二维码元素，等待更长时间后截取整个页面
        ulog("QR code element not found, waiting longer and taking full page screenshot")
        time.sleep(5)  # 再等待 5 秒
        page_path = os.path.join(os.getcwd(), "temp_qrcode.png")
        page.screenshot(path=page_path)
        ulog(f"Full page screenshot saved to: {page_path}")
        return page_path

    except Exception as e:
        ulog(f"Failed to capture QR code: {e}")
        return ""

def classify_browser_state(browser):
    has_login = False
    has_dashboard = False
    details = []
    for idx, page in enumerate(browser.pages):
        try:
            url = page.url or ""
            # 详细记录 URL 用于诊断
            ulog(f"[DEBUG] Page {idx} full URL: {url}")

            login_url = is_on_login_page(url)
            dashboard_url = is_on_dashboard(url)
            login_ui = page_has_login_ui(page)
            dashboard_ui = page_has_dashboard_ui(page)

            # 获取页面标题
            page_title = ""
            try:
                page_title = page.title()
                ulog(f"[DEBUG] Page {idx} title: {page_title}")
            except Exception:
                pass

            # 尝试检测页面内容中是否有登录相关的文本
            has_login_text = False
            has_dashboard_text = False
            has_intro_page = False  # 介绍页面标记
            try:
                # 获取页面文本内容（限制长度避免性能问题）
                page_text = page.evaluate("() => document.body.innerText.substring(0, 1000)")
                if page_text:
                    ulog(f"[DEBUG] Page {idx} text preview: {page_text[:200]}")

                    # 优先检测介绍页面（未登录时显示的页面）
                    if "一站式服务" in page_text and "让创作更简单" in page_text:
                        has_intro_page = True
                        ulog(f"[DEBUG] Detected intro page (not logged in)")
                    # 检测登录相关文本
                    elif any(keyword in page_text for keyword in ["扫码登录", "二维码登录", "请使用微信扫码", "Scan QR Code"]):
                        has_login_text = True
                        ulog(f"[DEBUG] Detected login text in page content")
                    # 检测 dashboard 相关文本（必须包含账号相关信息）
                    # 真正的 dashboard 会显示：昨日数据、净增关注、新增播放、关注者、申请认证、通知中心等
                    elif any(keyword in page_text for keyword in ["昨日数据", "净增关注", "新增播放", "关注者", "申请认证", "通知中心"]):
                        has_dashboard_text = True
                        ulog(f"[DEBUG] Detected dashboard text in page content")
            except Exception as e:
                ulog(f"[DEBUG] Failed to get page text: {e}")

            details.append({
                "index": idx,
                "url": url[:160],
                "login_url": login_url,
                "dashboard_url": dashboard_url,
                "login_ui": login_ui,
                "dashboard_ui": dashboard_ui,
                "title": page_title[:80] if page_title else "",
                "has_login_text": has_login_text,
                "has_dashboard_text": has_dashboard_text,
                "has_intro_page": has_intro_page,
            })

            # 判断逻辑（严格模式）：
            # 1. 如果检测到介绍页面，说明未登录
            if has_intro_page:
                has_login = True
                ulog(f"[DEBUG] Marked as need login (intro page)")
            # 2. 如果 URL 明确是登录页，直接判定为需要登录
            elif login_url:
                has_login = True
                ulog(f"[DEBUG] Detected login by URL")
            # 3. 如果检测到登录相关文本，判定为需要登录
            elif has_login_text:
                has_login = True
                ulog(f"[DEBUG] Detected login by page text")
            # 4. 如果页面标题包含登录关键词，判定为需要登录
            elif page_title and ("登录" in page_title or "Login" in page_title):
                has_login = True
                ulog(f"[DEBUG] Detected login by title: {page_title}")
            # 5. 只有当 URL 是 dashboard 且有 dashboard 相关内容时，才判定为已登录
            elif dashboard_url and has_dashboard_text:
                has_dashboard = True
                ulog(f"[DEBUG] Detected dashboard by URL + content")

        except Exception as e:
            ulog(f"Page classify error[{idx}]: {e}")

    # 返回优先级：优先返回明确的状态
    if has_login:
        return "login", details
    if has_dashboard:
        return "dashboard", details
    return "unknown", details

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-data-dir", required=True)
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--wait-after-qr-seconds", type=int, default=180)
    args = parser.parse_args()

    user_data_dir = os.path.abspath(args.user_data_dir)
    os.makedirs(user_data_dir, exist_ok=True)
    account_display = args.account_id[:20]  # 截取前20个字符用于显示
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
            close_stale_pages(browser, keep_page=page)

            # 设置浏览器标题，方便区分多个窗口
            try:
                page.evaluate(f"""() => {{
                    document.title = '登录检测 - {account_display}';
                }}""")
            except Exception:
                pass

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

            # 再等待一下，确保页面完全加载和可能的跳转完成
            time.sleep(2)

            # 等待可能的重定向完成（未登录时会从 /platform 重定向到 login.html）
            # 检查 URL 是否稳定
            initial_url = page.url
            time.sleep(2)
            final_url = page.url
            if initial_url != final_url:
                ulog(f"Detected redirect: {initial_url[:80]} -> {final_url[:80]}")
                # 如果发生了重定向，再等待一下确保页面加载完成
                time.sleep(2)

            # Log all page URLs for diagnostics
            for idx, pg in enumerate(browser.pages):
                try:
                    ulog(f"  page[{idx}] url={pg.url[:120]}")
                except Exception:
                    pass

            state, details = classify_browser_state(browser)
            ulog(f"Initial browser state={state}")

            # 详细输出判断依据
            for detail in details:
                ulog(f"  Page {detail['index']}: URL={detail['url'][:80]}")
                ulog(f"    login_url={detail['login_url']}, login_ui={detail['login_ui']}")
                ulog(f"    dashboard_url={detail['dashboard_url']}, dashboard_ui={detail['dashboard_ui']}")

            if state == "dashboard":
                ulog("Already logged in — session cookies are valid!")
                print(json.dumps({"success": True, "status": "logged_in"}), flush=True)
                time.sleep(2)
                browser.close()
                return

            # 如果状态是 unknown，可能是页面还在加载，再等待一下
            if state == "unknown":
                ulog("State is unknown, waiting a bit more...")
                time.sleep(3)
                state, details = classify_browser_state(browser)
                ulog(f"Re-check browser state={state}")

                # 再次详细输出
                for detail in details:
                    ulog(f"  Page {detail['index']}: URL={detail['url'][:80]}")
                    ulog(f"    login_url={detail['login_url']}, login_ui={detail['login_ui']}")
                    ulog(f"    dashboard_url={detail['dashboard_url']}, dashboard_ui={detail['dashboard_ui']}")

                if state == "dashboard":
                    ulog("Confirmed logged in after re-check!")
                    print(json.dumps({"success": True, "status": "logged_in"}), flush=True)
                    time.sleep(2)
                    browser.close()
                    return

            # We ended up on the login page — need QR scan
            ulog("On login page — QR scan needed")

            # 等待二维码加载（页面可能还在渲染）
            ulog("Waiting for QR code to load...")

            # 尝试等待二维码元素出现
            qr_loaded = False
            try:
                ulog("Checking if QR code element appears...")
                # 等待二维码相关元素出现（最多等待15秒）
                page.wait_for_selector("iframe[src*='login-for-iframe'], .login-qrcode-wrap, .qrcode-wrap, img.qrcode, img[src*='qrcode']", timeout=15000)
                ulog("QR code element detected!")
                qr_loaded = True
            except Exception as e:
                ulog(f"QR code element not found after 15s: {e}")

            # 如果二维码元素出现了，再等待一下确保图片加载完成
            if qr_loaded:
                ulog("Waiting for QR code image to fully load...")
                time.sleep(3)
            else:
                # 如果没检测到元素，等待更长时间
                ulog("QR code element not detected, waiting longer...")
                time.sleep(8)

            # 捕获二维码图片
            qr_code_path = capture_qrcode(page)

            print(json.dumps({
                "success": True,
                "status": "need_scan",
                "qrCodeBase64": "",
                "qrCodePath": qr_code_path,
                "message": "请在弹出的浏览器窗口中扫描二维码"
            }), flush=True)

            # Wait for user to scan and confirm
            timeout_sec = max(120, int(args.wait_after_qr_seconds))
            deadline = time.time() + timeout_sec
            check_count = 0

            while time.time() < deadline:
                time.sleep(2)
                check_count += 1

                # 检查浏览器是否还有页面
                if len(browser.pages) == 0:
                    ulog("Browser has no pages, user may have closed the window")
                    print(json.dumps({
                        "success": False,
                        "status": "cancelled",
                        "error": "浏览器窗口已关闭"
                    }), flush=True)
                    try:
                        browser.close()
                    except Exception:
                        pass
                    return

                # 每次都检查页面内容，看是否有账号信息出现（说明登录成功）
                try:
                    page = browser.pages[0]
                    page_text = page.evaluate("() => document.body.innerText.substring(0, 1000)")

                    # 如果检测到账号相关信息，说明登录成功
                    if any(keyword in page_text for keyword in ["昨日数据", "净增关注", "新增播放", "关注者", "视频号ID", "申请认证"]):
                        ulog(f"Login success detected by page content! (poll #{check_count})")
                        print(json.dumps({"success": True, "status": "logged_in"}), flush=True)
                        time.sleep(3)
                        browser.close()
                        return

                    # 如果不再是介绍页面，也检查一下完整状态
                    if "一站式服务" not in page_text:
                        state, details = classify_browser_state(browser)
                        if state == "dashboard":
                            ulog(f"Login success detected by state! (poll #{check_count})")
                            print(json.dumps({"success": True, "status": "logged_in"}), flush=True)
                            time.sleep(3)
                            browser.close()
                            return
                except Exception as e:
                    ulog(f"Error checking page content: {e}")

                # Periodic diagnostics
                if check_count % 10 == 0:
                    for idx, pg in enumerate(browser.pages):
                        try:
                            ulog(f"  [poll #{check_count}] page[{idx}] url={pg.url[:120]}")
                        except Exception:
                            pass

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
