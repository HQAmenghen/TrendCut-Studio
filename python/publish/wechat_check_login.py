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
                        "title": "⚠️ 视频号掉线通知",
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
                # QR code is inside a nested iframe whose URL contains 'login-for-iframe'
                # page.frames includes all frames; find the right one
                qr_frame = None
                for frame in page.frames:
                    if 'login-for-iframe' in frame.url:
                        qr_frame = frame
                        break
                if not qr_frame:
                    raise Exception("找不到包含二维码的 iframe")
                img_el = qr_frame.wait_for_selector("img.qrcode", state="visible", timeout=15000)
                
                # Make sure the image is fully loaded
                time.sleep(2)
                
                # Save screenshot of the QR code
                img_el.screenshot(path=qr_code_path)
                
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
                }))
                
                browser.close()
                return
            except Exception as e:
                ulog(f"Timeout waiting for QR code: {e}")
                print(json.dumps({"success": False, "error": "无法获取登录二维码或页面结构已变"}))
                browser.close()
                return
            
    except Exception as e:
        ulog(f"Fatal error: {e}")
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    main()
