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

def upload_to_feishu(app_id: str, app_secret: str, image_path: str):
    try:
        # 1. Get tenant base access token
        url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
        payload = {
            "app_id": app_id,
            "app_secret": app_secret
        }
        res = requests.post(url, json=payload, timeout=10)
        res_data = res.json()
        if res_data.get("code") != 0:
            ulog(f"Feishu token error: {res_data}")
            return None
        token = res_data.get("tenant_access_token")
        
        # 2. Upload image
        upload_url = "https://open.feishu.cn/open-apis/im/v1/images"
        headers = {
            "Authorization": f"Bearer {token}"
        }
        with open(image_path, "rb") as f:
            files = {
                "image_type": (None, "message"),
                "image": (os.path.basename(image_path), f, "image/png")
            }
            res_img = requests.post(upload_url, headers=headers, files=files, timeout=10)
            img_data = res_img.json()
            if img_data.get("code") != 0:
                ulog(f"Feishu upload error: {img_data}")
                return None
            return img_data.get("data", {}).get("image_key")
    except Exception as e:
        ulog(f"Feishu generic error: {e}")
        return None

def push_to_feishu_webhook(webhook_url: str, account_id: str, image_key: str):
    try:
        payload = {
            "msg_type": "post",
            "content": {
                "post": {
                    "zh_cn": {
                        "title": "鈿狅笍 瑙嗛鍙锋帀绾块€氱煡",
                        "content": [
                            [
                                {
                                    "tag": "text",
                                    "text": f"绯荤粺妫€娴嬪埌瑙嗛鍙?[{account_id}] 宸叉帀绾匡紝璇锋壂鐮侀噸鏂扮櫥褰曪細"
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
    parser.add_argument("--wait-after-qr-seconds", type=int, default=90)
    args = parser.parse_args()

    user_data_dir = os.path.abspath(args.user_data_dir)
    os.makedirs(user_data_dir, exist_ok=True)
    
    qr_code_path = os.path.join(user_data_dir, "qrcode.png")

    ulog(f"Starting check for {args.account_id}")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch_persistent_context(
                user_data_dir=user_data_dir,
                headless=True,
                viewport={"width": 1280, "height": 800},
                args=["--disable-blink-features=AutomationControlled"]
            )
            page = browser.pages[0] if browser.pages else browser.new_page()

            ulog("Navigating to channels...")
            page.goto("https://channels.weixin.qq.com/platform/login", wait_until="networkidle")
            time.sleep(3)

            ulog("Checking login state...")
            try:
                page.wait_for_selector(".weui-desktop-layout__main__bd", timeout=5000)
                print(json.dumps({"success": True, "status": "logged_in"}))
                browser.close()
                return
            except:
                pass

            ulog("Checking for QR code...")
            try:
                login_frame = None
                frame_deadline = time.time() + 12
                while time.time() < frame_deadline:
                    login_frame = find_login_frame(page)
                    if login_frame:
                        break
                    time.sleep(0.5)

                img_loc = None

                if login_frame:
                    ulog(f"Found login iframe: {safe_frame_url(login_frame)}")
                    for selector in QR_SELECTORS:
                        candidate = login_frame.locator(selector).first
                        try:
                            candidate.wait_for(state="visible", timeout=4000)
                            img_loc = candidate
                            ulog(f"QR selector matched in iframe: {selector}")
                            break
                        except Exception:
                            continue

                if img_loc is None:
                    for selector in QR_SELECTORS:
                        candidate = page.locator(selector).first
                        try:
                            candidate.wait_for(state="visible", timeout=2000)
                            img_loc = candidate
                            ulog(f"QR selector matched in page: {selector}")
                            break
                        except Exception:
                            continue

                if img_loc is None:
                    raise RuntimeError(f"浜岀淮鐮佽妭鐐规湭鎵惧埌锛屽綋鍓?URL: {page.url}")
                
                # Make sure the image is fully loaded
                time.sleep(2)
                
                # Save screenshot of the QR code
                img_loc.screenshot(path=qr_code_path)
                
                with open(qr_code_path, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode("utf-8")
                
                ulog("QR code captured.")
                
                # Push to Feishu if configured
                if args.feishu_app_id and args.feishu_app_secret and args.feishu_webhook:
                    image_key = upload_to_feishu(args.feishu_app_id, args.feishu_app_secret, qr_code_path)
                    if image_key:
                        push_to_feishu_webhook(args.feishu_webhook, args.account_id, image_key)

                print(json.dumps({
                    "success": True, 
                    "status": "need_scan", 
                    "qrCodeBase64": f"data:image/png;base64,{b64}"
                }), flush=True)

                ulog("Waiting for scan confirmation...")
                deadline = time.time() + max(10, int(args.wait_after_qr_seconds))
                while time.time() < deadline:
                    try:
                        if has_any_success_selector(page):
                            print(json.dumps({"success": True, "status": "logged_in"}), flush=True)
                            browser.close()
                            return
                    except Exception:
                        pass
                    try:
                        login_frame = find_login_frame(page)
                        if login_frame and has_any_success_selector(login_frame):
                            print(json.dumps({"success": True, "status": "logged_in"}), flush=True)
                            browser.close()
                            return
                    except Exception:
                        pass
                    try:
                        current_url = page.url
                        if "platform/post/create" in current_url:
                            print(json.dumps({"success": True, "status": "logged_in"}), flush=True)
                            browser.close()
                            return
                    except Exception:
                        pass
                    try:
                        if any_frame_url_contains(page, "platform/post/create") or any_page_url_contains(browser, "platform/post/create"):
                            ulog("Detected post/create in frame or page URL")
                            print(json.dumps({"success": True, "status": "logged_in"}), flush=True)
                            browser.close()
                            return
                    except Exception:
                        pass
                    try:
                        login_frame = find_login_frame(page)
                        if login_frame:
                            qr_visible = False
                            for selector in QR_SELECTORS:
                                try:
                                    if login_frame.locator(selector).first.is_visible(timeout=500):
                                        qr_visible = True
                                        break
                                except Exception:
                                    continue
                            if not qr_visible and not safe_locator_count(login_frame, ".err-tips") and not safe_locator_count(login_frame, ".weui-toptips_error"):
                                ulog("QR code disappeared from login frame; treating as logged in")
                                print(json.dumps({"success": True, "status": "logged_in"}), flush=True)
                                browser.close()
                                return
                    except Exception:
                        pass
                    time.sleep(1)

                print(json.dumps({"success": False, "status": "expired", "error": "浜岀淮鐮佸凡杩囨湡锛岃閲嶆柊鎵爜"}), flush=True)
                browser.close()
                return
            except Exception as e:
                ulog(f"Timeout waiting for QR code: {e}")
                print(json.dumps({"success": False, "error": "鏃犳硶鑾峰彇鐧诲綍浜岀淮鐮佹垨椤甸潰缁撴瀯宸插彉"}), flush=True)
                browser.close()
                return
            
    except Exception as e:
        ulog(f"Fatal error: {e}")
        print(json.dumps({"success": False, "error": str(e)}), flush=True)

if __name__ == "__main__":
    main()
