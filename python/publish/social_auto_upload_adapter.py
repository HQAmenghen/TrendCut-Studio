import argparse
import asyncio
import base64
import json
import os
import sys
from pathlib import Path


def clean_pipe_text(value: str) -> str:
    return str(value or "").replace("|", " ").replace("\n", " ").strip()


def emit(state: str, message: str, percent: int = 0, **extra) -> None:
    payload = {"percent": percent, **extra}
    print(
        f"STATUS|{clean_pipe_text(state)}|social-auto-upload|{clean_pipe_text(message)}|"
        f"{json.dumps(payload, ensure_ascii=False)}",
        flush=True,
    )


def normalize_qrcode_payload(payload: dict | None, platform_label: str, account_name: str) -> dict:
    source = payload if isinstance(payload, dict) else {}
    image_data_url = str(source.get("image_data_url") or "").strip()
    image_path = str(source.get("image_path") or "").strip()
    qr_code_base64 = image_data_url
    if not qr_code_base64 and image_path:
        try:
            with open(image_path, "rb") as file:
                qr_code_base64 = "data:image/png;base64," + base64.b64encode(file.read()).decode("ascii")
        except OSError:
            qr_code_base64 = ""

    return {
        "qrCodeBase64": qr_code_base64,
        "qrCodePath": image_path,
        "accountLabel": platform_label,
        "accountId": account_name,
    }


def log(message: str) -> None:
    print(f"LOG|{clean_pipe_text(message)}", flush=True)


def load_payload(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as file:
        payload = json.load(file)
    return payload if isinstance(payload, dict) else {}


def load_sau_modules(sau_dir: str):
    root = Path(sau_dir or os.environ.get("SOCIAL_AUTO_UPLOAD_DIR") or "").resolve()
    if not root.exists():
        raise FileNotFoundError(f"social-auto-upload directory not found: {root}")
    root_text = str(root)
    if root_text not in sys.path:
        sys.path.insert(0, root_text)

    from patchright.async_api import async_playwright
    from uploader.douyin_uploader.main import (
        DOUYIN_PUBLISH_STRATEGY_IMMEDIATE,
        DouYinVideo,
        douyin_setup,
    )
    from uploader.xiaohongshu_uploader.main import (
        XHS_PUBLISH_VIDEO_URL,
        XIAOHONGSHU_PUBLISH_STRATEGY_IMMEDIATE,
        XiaoHongShuVideo,
        xiaohongshu_setup,
    )
    from utils.base_social_media import set_init_script

    return {
        "root": root,
        "async_playwright": async_playwright,
        "DouYinVideo": DouYinVideo,
        "douyin_setup": douyin_setup,
        "DOUYIN_PUBLISH_STRATEGY_IMMEDIATE": DOUYIN_PUBLISH_STRATEGY_IMMEDIATE,
        "XHS_PUBLISH_VIDEO_URL": XHS_PUBLISH_VIDEO_URL,
        "XIAOHONGSHU_PUBLISH_STRATEGY_IMMEDIATE": XIAOHONGSHU_PUBLISH_STRATEGY_IMMEDIATE,
        "XiaoHongShuVideo": XiaoHongShuVideo,
        "xiaohongshu_setup": xiaohongshu_setup,
        "set_init_script": set_init_script,
    }


def resolve_runtime_dir(runtime_dir: str) -> Path:
    configured = runtime_dir or os.environ.get("SOCIAL_AUTO_UPLOAD_RUNTIME_DIR") or ""
    if configured:
        root = Path(configured).resolve()
    else:
        root = Path(__file__).resolve().parents[2] / "data" / "social-auto-upload-runtime"
    root.mkdir(parents=True, exist_ok=True)
    os.environ["SOCIAL_AUTO_UPLOAD_RUNTIME_DIR"] = str(root)
    return root


def resolve_account_file(runtime_dir: Path, platform: str, account_name: str) -> Path:
    safe_platform = "".join(char for char in platform if char.isalnum() or char in ("-", "_")).strip("_-")
    safe_account = "".join(char for char in account_name if char.isalnum() or char in ("-", "_")).strip("_-")
    if not safe_platform or not safe_account:
        raise ValueError("Invalid social-auto-upload account name")
    account_file = runtime_dir / "cookies" / f"{safe_platform}_{safe_account}.json"
    account_file.parent.mkdir(parents=True, exist_ok=True)
    return account_file


async def wait_for_manual_close(context, platform_label: str) -> None:
    emit("ready_for_manual_publish", f"{platform_label}已完成上传和填写，请人工确认发布页后关闭浏览器", 100)
    while len(context.pages) > 0:
        await asyncio.sleep(5)


def normalize_tags(value) -> list[str]:
    if isinstance(value, list):
        source = value
    else:
        source = str(value or "").split(",")
    return [str(item).strip().lstrip("#") for item in source if str(item).strip()]


def build_common_payload(payload: dict) -> dict:
    return {
        "platform": str(payload.get("platform") or "").strip(),
        "platform_label": str(payload.get("platformLabel") or payload.get("platform") or "平台").strip(),
        "publish_mode": str(payload.get("publishMode") or "draft").strip(),
        "account_name": str(payload.get("accountName") or payload.get("accountId") or payload.get("accountLabel") or "").strip(),
        "video_path": str(payload.get("videoPath") or "").strip(),
        "title": str(payload.get("title") or "视频发布").strip(),
        "description": str(payload.get("description") or "").strip(),
        "tags": normalize_tags(payload.get("tags") or []),
        "headless": bool(payload.get("headless", False)),
    }


async def ensure_cookie_ready(modules: dict, runtime_dir: Path, platform: str, account_name: str, headless: bool) -> Path:
    account_file = resolve_account_file(runtime_dir, platform, account_name)
    setup_fn = modules["douyin_setup"] if platform == "douyin" else modules["xiaohongshu_setup"]
    emit("checking_login", f"正在检查{platform}登录态", 10)
    platform_label = "抖音" if platform == "douyin" else "小红书"

    def handle_qrcode(qrcode_payload: dict) -> None:
        emit(
            "need_login",
            f"{platform_label}需要扫码登录，请在控制台扫描二维码",
            20,
            **normalize_qrcode_payload(qrcode_payload, platform_label, account_name),
        )

    ready = await setup_fn(
        str(account_file),
        handle=True,
        return_detail=True,
        qrcode_callback=handle_qrcode,
        headless=headless,
    )
    if not ready.get("success"):
        raise RuntimeError(ready.get("message") or f"{platform}登录态不可用")
    emit("login_ready", f"{platform_label}登录态可用", 25, accountLabel=platform_label, accountId=account_name)
    return account_file


async def run_douyin_draft(modules: dict, app) -> None:
    async_playwright = modules["async_playwright"]
    set_init_script = modules["set_init_script"]
    emit("uploading", "正在通过 social-auto-upload 进入抖音上传页", 35)
    async with async_playwright() as playwright:
        await app.validate_upload_args()
        browser = await playwright.chromium.launch(headless=app.headless, channel="chrome")
        context = await browser.new_context(
            storage_state=f"{app.account_file}",
            permissions=["geolocation"],
        )
        context = await set_init_script(context)
        try:
            page = await context.new_page()
            await page.goto("https://creator.douyin.com/creator-micro/content/upload")
            await page.wait_for_url("https://creator.douyin.com/creator-micro/content/upload")
            await page.locator("div[class^='container'] input").set_input_files(app.file_path)

            while True:
                try:
                    await page.wait_for_url(
                        "https://creator.douyin.com/creator-micro/content/publish?enter_from=publish_page",
                        timeout=3000,
                    )
                    break
                except Exception:
                    try:
                        await page.wait_for_url(
                            "https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page",
                            timeout=3000,
                        )
                        break
                    except Exception:
                        await asyncio.sleep(0.5)

            emit("editing", "抖音视频已进入发布编辑页，正在填写标题和描述", 65)
            await app.fill_title_and_description(page, app.title, app.desc or app.title, app.tags)

            while True:
                if await page.locator('[class^="long-card"] div:has-text("重新上传")').count() > 0:
                    break
                if await page.locator('div.progress-div > div:has-text("上传失败")').count():
                    await app.handle_upload_error(page)
                await asyncio.sleep(2)

            if app.productLink and app.productTitle:
                await app.set_product_link(page, app.productLink, app.productTitle)

            await app.set_thumbnail(page)
            await context.storage_state(path=app.account_file)
            emit("edited", "抖音草稿内容已填写完毕，等待人工确认", 90)
            await wait_for_manual_close(context, "抖音")
        finally:
            await context.close()
            await browser.close()


async def run_xiaohongshu_draft(modules: dict, app) -> None:
    async_playwright = modules["async_playwright"]
    set_init_script = modules["set_init_script"]
    emit("uploading", "正在通过 social-auto-upload 进入小红书发布页", 35)
    async with async_playwright() as playwright:
        await app.validate_upload_args()
        browser = await playwright.chromium.launch(headless=app.headless, channel="chrome")
        context = await browser.new_context(
            permissions=["geolocation"],
            storage_state=app.account_file,
        )
        context = await set_init_script(context)
        try:
            page = await context.new_page()
            await page.goto(modules["XHS_PUBLISH_VIDEO_URL"])
            await page.wait_for_url(modules["XHS_PUBLISH_VIDEO_URL"])
            await page.locator("div[class^='upload-content'] input[class='upload-input']").set_input_files(app.file_path)

            while True:
                try:
                    upload_input = await page.wait_for_selector("input.upload-input", timeout=3000)
                    preview_new = await upload_input.query_selector(
                        'xpath=following-sibling::div[contains(@class, "preview-new")]'
                    )
                    if preview_new:
                        all_text = await preview_new.inner_text()
                        if any(keyword in all_text for keyword in ["上传成功", "分辨率", "重新上传", "编辑封面", "已上传", "已选择", "100%"]):
                            break
                    title_container = page.locator('input[placeholder*="填写标题"]')
                    if await title_container.count() > 0 and await title_container.is_visible():
                        break
                except Exception:
                    title_container = page.locator('input[placeholder*="填写标题"]')
                    if await title_container.count() > 0 and await title_container.is_visible():
                        break
                await asyncio.sleep(2)

            emit("editing", "小红书视频已上传，正在填写标题和描述", 65)
            await app.fill_meta(page)
            await app.set_thumbnail(page, app.thumbnail_path)
            await context.storage_state(path=app.account_file)
            emit("edited", "小红书草稿内容已填写完毕，等待人工确认", 90)
            await wait_for_manual_close(context, "小红书")
        finally:
            await context.close()
            await browser.close()


async def run_payload(payload: dict, sau_dir: str, runtime_dir: str) -> None:
    data = build_common_payload(payload)
    if data["platform"] not in {"douyin", "xiaohongshu"}:
        raise ValueError(f"Unsupported platform: {data['platform']}")
    if not data["account_name"]:
        raise ValueError("Missing social-auto-upload account name")
    if not Path(data["video_path"]).exists():
        raise FileNotFoundError(f"Video file not found: {data['video_path']}")

    runtime_root = resolve_runtime_dir(runtime_dir)
    modules = load_sau_modules(sau_dir)
    account_file = await ensure_cookie_ready(modules, runtime_root, data["platform"], data["account_name"], data["headless"])

    if data["platform"] == "douyin":
        app = modules["DouYinVideo"](
            data["title"],
            data["video_path"],
            data["tags"],
            0,
            str(account_file),
            desc=data["description"],
            publish_strategy=modules["DOUYIN_PUBLISH_STRATEGY_IMMEDIATE"],
            debug=False,
            headless=data["headless"],
        )
        if data["publish_mode"] == "draft":
            await run_douyin_draft(modules, app)
        else:
            emit("publishing", "正在通过 social-auto-upload 自动发布抖音视频", 45)
            await app.douyin_upload_video()
            emit("success", "抖音视频已提交发布", 100)
        return

    app = modules["XiaoHongShuVideo"](
        data["title"],
        data["video_path"],
        data["tags"],
        0,
        str(account_file),
        desc=data["description"],
        publish_strategy=modules["XIAOHONGSHU_PUBLISH_STRATEGY_IMMEDIATE"],
        debug=False,
        headless=data["headless"],
    )
    if data["publish_mode"] == "draft":
        await run_xiaohongshu_draft(modules, app)
    else:
        emit("publishing", "正在通过 social-auto-upload 自动发布小红书视频", 45)
        await app.xiaohongshu_upload_video()
        emit("success", "小红书视频已提交发布", 100)


def main() -> int:
    parser = argparse.ArgumentParser(description="Direct social-auto-upload adapter")
    parser.add_argument("--payload", required=True)
    parser.add_argument("--social-auto-upload-dir", default="")
    parser.add_argument("--runtime-dir", default="")
    args = parser.parse_args()
    payload = load_payload(Path(args.payload))
    emit("starting", "正在启动 social-auto-upload 代码级适配器", 3)
    asyncio.run(run_payload(payload, args.social_auto_upload_dir, args.runtime_dir))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        emit("failed", str(exc), 100)
        raise
