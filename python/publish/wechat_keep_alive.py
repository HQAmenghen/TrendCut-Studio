import argparse
import time
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

def main():
    parser = argparse.ArgumentParser(description="WeChat Channels Keep-Alive Daemon")
    parser.add_argument("--user-data-dir", required=True, help="Path to browser profile")
    args = parser.parse_args()

    user_data_dir = Path(args.user_data_dir)
    print(f"KEEP_ALIVE|STARTING|{user_data_dir}", flush=True)

    p = sync_playwright().start()
    
    # Optional performance optimization: Minimal viewport, no download
    browser = p.chromium.launch_persistent_context(
        str(user_data_dir),
        headless=True,
        viewport={"width": 1280, "height": 800},
        accept_downloads=False
    )
    try:
        page = browser.pages[0] if browser.pages else browser.new_page()
        
        url = "https://channels.weixin.qq.com/platform/post/create"
        
        try:
            page.goto(url, timeout=60000, wait_until="domcontentloaded")
            print(f"KEEP_ALIVE|LOADED|{url}", flush=True)
        except Exception as e:
            print(f"KEEP_ALIVE|ERROR_LOAD|{e}", flush=True)
            
        print("KEEP_ALIVE|READY|Entering daemon mode...", flush=True)
        
        loop_count = 0
        while True:
            # Sleep in small chunks to handle graceful shutdown gracefully if needed
            # but usually SIGTERM from Node kills it instantly.
            time.sleep(1800) # 30 minutes
            loop_count += 1
            try:
                page.reload(timeout=30000, wait_until="domcontentloaded")
                print(f"KEEP_ALIVE|RELOADED|Loop {loop_count}", flush=True)
            except Exception as e:
                print(f"KEEP_ALIVE|ERROR_RELOAD|{e}", flush=True)
                
    finally:
        try:
            browser.close()
            p.stop()
        except:
            pass

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"KEEP_ALIVE|FATAL|{exc}", flush=True)
        sys.exit(1)
