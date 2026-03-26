import os
import sys
import json
import time
import requests
import argparse
import base64
from pathlib import Path
from playwright.sync_api import sync_playwright

def ulog(msg: str):
    print(f"WECHAT_LOGIN_CHECK|{msg}", flush=True)

QR_SELECTORS = [
    ".qrcode-wrap img.qrcode",
    "img.qrcode",
    ".qrcode",
]

LOGIN_SUCCESS_SELECTORS = [
    ".weui-desktop-layout__main__bd",
    ".weui-desktop-layout__side-panel",
    ".finder-container",
    ".creator-name",
    ".nickname",
    ".platform_header",
    ".status",
    ".login-status",
    ".success",
    ".weui-icon-success",
    ".success-img",
    ".icon.success-img",
    ".scanned",
    ".mask.scanned",
]

def safe_frame_url(frame):
    try:
        return frame.url or ""
    except Exception:
        return ""

def safe_locator_count(scope, selector: str) -> int:
    try:
        return scope.locator(selector).count()
    except Exception:
        return 0

def score_login_frame(frame):
    score = 0
    frame_url = safe_frame_url(frame)
    if "login-for-iframe" in frame_url:
        score += 10
    elif "channels.weixin.qq.com/platform/login" in frame_url:
        score += 6
    if safe_locator_count(frame, ".qrcode-wrap") > 0:
        score += 20
    if safe_locator_count(frame, "img.qrcode") > 0:
        score += 25
    if safe_locator_count(frame, ".qrcode") > 0:
        score += 10
    if safe_locator_count(frame, ".login-qrcode-wrap") > 0:
        score += 12
    if safe_locator_count(frame, ".finder-page") > 0:
        score += 4
    return score

def find_login_frame(page):
    best_frame = None
    best_score = 0
    for frame in page.frames:
        score = score_login_frame(frame)
        if score > best_score:
            best_score = score
            best_frame = frame
    if best_frame:
        ulog(f"Selected login iframe score={best_score} url={safe_frame_url(best_frame)}")
    return best_frame

def any_frame_url_contains(page, needle: str) -> bool:
    for frame in page.frames:
        if needle in safe_frame_url(frame):
            return True
    return False

def any_page_url_contains(context, needle: str) -> bool:
    for current_page in context.pages:
        try:
            if needle in (current_page.url or ""):
                return True
        except Exception:
            continue
    return False

def has_any_success_selector(scope) -> bool:
    for selector in LOGIN_SUCCESS_SELECTORS:
        if safe_locator_count(scope, selector) > 0:
            return True
    return False

def upload_to_feishu(app_id, app_secret, image_path):
    try:
        token_url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
        token_res = requests.post(token_url, json={"app_id": app_id, "app_secret": app_secret}, timeout=10)
        token = token_res.json().get("tenant_access_token")
        if not token: return None
        
        upload_url = "https://open.feishu.cn/open-apis/im/v1/images"
        with open(image_path, "rb") as f:
            files = {"image": f, "image_type": (None, "message")}
            headers = {"Authorization": f"Bearer {token}"}
            res = requests.post(upload_url, headers=headers, files=files, timeout=15)
            return res.json().get("data", {}).get("image_key")
    except Exception as e:
        ulog(f"Upload to feishu failed: {e}")
        return None

def push_to_feishu_webhook(webhook_url, account_id, image_key):
    try:
        payload = {
            "msg_type": "post",
            "content": {
                "post": {
                    "zh_cn": {
                        "title": "视频号登录扫码",
                        "content": [
                            [
                                {
                                    "tag": "text",
                                    "text": f"系统检测到视频号 [{account_id}] 已掉线，请扫码重新登录："
                                }
                            ],
                            [
                                {
                                    "tag": "img",
                                    "image_key": image_key
                                }
                            ]
                        ]
                    }
                }
            }
        }
        requests.post(webhook_url, json=payload, timeout=10)
    except Exception as e:
        ulog(f"Feishu webhook error: {e}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-data-dir", required=True)
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--feishu-app-id", default="")
    parser.add_argument("--feishu-app-secret", default="")
    parser.add_argument("--feishu-webhook", default="")
    parser.add_argument("--wait-after-qr-seconds", type=int, default=180)
    args = parser.parse_args()

    user_data_dir = os.path.abspath(args.user_data_dir)
    os.makedirs(user_data_dir, exist_ok=True)
    qr_code_path = os.path.join(user_data_dir, "qrcode.png")

    ulog(f"Starting check for {args.account_id}")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch_persistent_context(
                user_data_dir=user_data_dir,
                headless=False,
                viewport={"width": 1280, "height": 800},
                args=["--disable-blink-features=AutomationControlled"]
            )
            page = browser.pages[0] if browser.pages else browser.new_page()

            ulog("Navigating to channels...")
            try:
                page.goto("https://channels.weixin.qq.com/platform/login", wait_until="load", timeout=45000)
            except Exception as e:
                ulog(f"Navigation warning: {e}")
            
            time.sleep(2)

            ulog("Waiting for login state or QR code...")
            img_loc = None
            login_frame = None
            
            # Combined wait loop for 20 seconds
            wait_deadline = time.time() + 20
            while time.time() < wait_deadline:
                # 1. Check for Login Success (URL or Selectors)
                current_url = page.url
                if ("channels.weixin.qq.com/platform" in current_url and "login" not in current_url):
                    if has_any_success_selector(page) or any_frame_url_contains(page, "platform/post/create") or "platform/details" in current_url:
                        ulog(f"Login detected on initial check! URL: {current_url}")
                        print(json.dumps({"success": True, "status": "logged_in"}), flush=True)
                        time.sleep(5)
                        browser.close()
                        return
                
                # 2. Check for QR Code in main page or frame
                for selector in QR_SELECTORS:
                    candidate = page.locator(selector).first
                    if candidate.count() > 0 and candidate.is_visible():
                        img_loc = candidate
                        ulog(f"QR found in main page: {selector}")
                        break
                
                if img_loc: break
                
                login_frame = find_login_frame(page)
                if login_frame:
                    for selector in QR_SELECTORS:
                        candidate = login_frame.locator(selector).first
                        if candidate.count() > 0 and candidate.is_visible():
                            img_loc = candidate
                            ulog(f"QR found in iframe: {selector}")
                            break
                    
                    if not img_loc and has_any_success_selector(login_frame):
                        ulog("Login detected in iframe!")
                        print(json.dumps({"success": True, "status": "logged_in"}), flush=True)
                        time.sleep(5)
                        browser.close()
                        return
                
                if img_loc: break
                time.sleep(1)

            if img_loc is None:
                raise RuntimeError(f"二维码节点未找到，当前 URL: {page.url}")
            
            def get_qr_b64(loc):
                for attempt in range(3):
                    try:
                        if not loc: return None
                        # Wait for visibility and stability
                        loc.wait_for(state="visible", timeout=5000)
                        img_bytes = loc.screenshot(timeout=10000)
                        if img_bytes:
                            with open(qr_code_path, "wb") as f:
                                f.write(img_bytes)
                            return base64.b64encode(img_bytes).decode("utf-8")
                    except Exception as e:
                        ulog(f"Screenshot attempt {attempt+1} failed: {e}")
                        time.sleep(1)
                return None

            # Initial capture
            time.sleep(1)
            last_qr_b64 = get_qr_b64(img_loc)
            if not last_qr_b64:
                # One last try: re-find the locator in case it went stale
                ulog("Initial capture failed, re-finding locator...")
                wait_deadline = time.time() + 10
                while time.time() < wait_deadline:
                    # Re-search
                    for selector in QR_SELECTORS:
                        candidate = page.locator(selector).first
                        if candidate.count() > 0 and candidate.is_visible():
                            img_loc = candidate
                            break
                    if img_loc and img_loc.is_visible(): break
                    
                    login_frame = find_login_frame(page)
                    if login_frame:
                        for selector in QR_SELECTORS:
                            candidate = login_frame.locator(selector).first
                            if candidate.count() > 0 and candidate.is_visible():
                                img_loc = candidate
                                break
                    if img_loc and img_loc.is_visible(): break
                    time.sleep(1)
                
                last_qr_b64 = get_qr_b64(img_loc)
                if not last_qr_b64:
                    raise RuntimeError(f"无法截取初始二维码 (Current URL: {page.url})")
            
            if args.feishu_app_id and args.feishu_app_secret and args.feishu_webhook:
                image_key = upload_to_feishu(args.feishu_app_id, args.feishu_app_secret, qr_code_path)
                if image_key:
                    push_to_feishu_webhook(args.feishu_webhook, args.account_id, image_key)

            print(json.dumps({
                "success": True, 
                "status": "need_scan", 
                "qrCodeBase64": f"data:image/png;base64,{last_qr_b64}"
            }), flush=True)

            ulog("Waiting for scan or QR refresh...")
            timeout_sec = max(180, int(args.wait_after_qr_seconds))
            deadline = time.time() + timeout_sec
            last_check_status = "need_scan"
            
            while time.time() < deadline:
                # 1. Success check
                try:
                    if has_any_success_selector(page) or (login_frame and has_any_success_selector(login_frame)):
                        ulog("Login detected via selector.")
                        print(json.dumps({"success": True, "status": "logged_in"}), flush=True)
                        time.sleep(5)
                        browser.close()
                        return
                except: pass

                # 2. Redirect check
                try:
                    current_url = page.url
                    is_on_platform = ("channels.weixin.qq.com/platform" in current_url and "login" not in current_url)
                    # For a true dashboard success, we want to see the platform URL AND at least one success indicator
                    if is_on_platform:
                        if has_any_success_selector(page) or any_frame_url_contains(page, "platform/post/create") or "platform/details" in current_url:
                            ulog(f"Login confirmed via URL and indicators: {current_url}")
                            print(json.dumps({"success": True, "status": "logged_in"}), flush=True)
                            time.sleep(5)
                            browser.close()
                            return
                except: pass

                # 3. Scanned state check
                try:
                    scanned_indicators = [".qrcode-success", ".weui-desktop-qr-code__success", "text='扫描成功'", "text='已扫码'"]
                    is_scanned = False
                    for sel in scanned_indicators:
                        # Check main page
                        loc = page.locator(sel).first
                        if loc.count() > 0 and loc.is_visible():
                            is_scanned = True
                            break
                        # Check login frame
                        if login_frame:
                            f_loc = login_frame.locator(sel).first
                            if f_loc.count() > 0 and f_loc.is_visible():
                                is_scanned = True
                                break
                    # Stronger text check for confirmation
                    if not is_scanned:
                        for text in ["请在手机上确认", "请在手机端确认"]:
                            t_loc = page.get_by_text(text).first
                            if t_loc.count() > 0 and t_loc.is_visible():
                                is_scanned = True
                                break
                            if login_frame:
                                ft_loc = login_frame.get_by_text(text).first
                                if ft_loc.count() > 0 and ft_loc.is_visible():
                                    is_scanned = True
                                    break
                    if is_scanned and last_check_status != "scanned":
                        ulog("Scan detected.")
                        print(json.dumps({"success": True, "status": "scanned", "message": "已扫码，请在手机上确认"}), flush=True)
                        last_check_status = "scanned"
                    
                    # If we WERE scanned and now the QR or its frame is gone, it's a strong login signal
                    if last_check_status == "scanned":
                        qr_still_there = False
                        try:
                            if img_loc and img_loc.is_visible(timeout=500):
                                qr_still_there = True
                        except: pass
                        
                        if not qr_still_there:
                            ulog("QR disappeared after scan; checking for login success...")
                            if has_any_success_selector(page) or (login_frame and has_any_success_selector(login_frame)) or "login" not in page.url:
                                ulog("Login confirmed after QR disappearance.")
                                print(json.dumps({"success": True, "status": "logged_in"}), flush=True)
                                time.sleep(5)
                                browser.close()
                                return
                        # Check QR refresh
                        current_qr_b64 = get_qr_b64(img_loc)
                        if current_qr_b64 and current_qr_b64 != last_qr_b64:
                            ulog("QR refreshed.")
                            last_qr_b64 = current_qr_b64
                            last_check_status = "need_scan"
                            if args.feishu_app_id and args.feishu_app_secret and args.feishu_webhook:
                                image_key = upload_to_feishu(args.feishu_app_id, args.feishu_app_secret, qr_code_path)
                                if image_key: push_to_feishu_webhook(args.feishu_webhook, args.account_id, image_key)
                            print(json.dumps({"success": True, "status": "need_scan", "qrCodeBase64": f"data:image/png;base64,{current_qr_b64}", "message": "二维码已刷新"}), flush=True)
                except: pass

                time.sleep(2)

            ulog("Login check timed out.")
            print(json.dumps({"success": False, "status": "expired", "error": f"登录超时（{timeout_sec}s）"}), flush=True)
            browser.close()

    except Exception as e:
        ulog(f"Fatal error: {e}")
        print(json.dumps({"success": False, "error": str(e)}), flush=True)

if __name__ == "__main__":
    main()
