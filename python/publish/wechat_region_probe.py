"""Probe the real WeChat Channels location widget without publishing."""

import argparse
import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from wechat_channels_rpa import (
    build_publish_text,
    build_short_title,
    ensure_logged_in,
    fill_publish_text,
    fill_short_title,
    get_contexts,
    select_no_region,
    upload_video,
)


LOCATION_SELECTORS = [
    ".post-position-wrap",
    ".position-display",
    ".position-display-wrap",
    ".location-filter-wrap",
    ".location-item",
    '[class*="position"]',
    '[class*="location"]',
]


def write_event(log_path: Path, stage: str, payload: dict) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps({"stage": stage, "payload": payload}, ensure_ascii=False)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")
    print(f"PROBE|{stage}|{line}", flush=True)


def dump_location_dom(page) -> list[dict]:
    script = """(selectors) => {
        const visible = (el) => {
            if (!el || !(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.visibility !== 'hidden'
                && style.display !== 'none'
                && rect.width > 0
                && rect.height > 0;
        };
        const textOf = (el) => String(el?.innerText || el?.textContent || '').replace(/\\s+/g, ' ').trim();
        const unique = new Set();
        const matches = [];
        for (const selector of selectors) {
            for (const el of Array.from(document.querySelectorAll(selector))) {
                if (unique.has(el)) continue;
                unique.add(el);
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                matches.push({
                    selector,
                    tag: String(el.tagName || '').toLowerCase(),
                    className: String(el.className || ''),
                    role: el.getAttribute('role') || '',
                    text: textOf(el),
                    visible: visible(el),
                    display: style.display,
                    visibility: style.visibility,
                    rect: {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                    },
                    html: String(el.outerHTML || '').slice(0, 1600),
                });
            }
        }
        return matches;
    }"""
    snapshots = []
    for context_name, context in get_contexts(page):
        try:
            matches = context.evaluate(script, LOCATION_SELECTORS)
            if matches:
                snapshots.append({
                    "context": context_name,
                    "url": str(getattr(context, "url", "")),
                    "matches": matches,
                })
        except Exception as exc:
            snapshots.append({
                "context": context_name,
                "error": str(exc),
            })
    return snapshots


def click_location_display(page) -> list[dict]:
    script = """() => {
        const visible = (el) => {
            if (!el || !(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.visibility !== 'hidden'
                && style.display !== 'none'
                && rect.width > 0
                && rect.height > 0;
        };
        const textOf = (el) => String(el?.innerText || el?.textContent || '').replace(/\\s+/g, ' ').trim();
        const fireClick = (target) => {
            try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
            try { target.focus?.(); } catch (_) {}
            const options = { bubbles: true, cancelable: true, view: window };
            for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
                try { target.dispatchEvent(new MouseEvent(type, options)); } catch (_) {}
            }
            try { target.click(); } catch (_) {}
        };
        const selectors = [
            '.post-position-wrap .position-display',
            '.position-display',
            '.position-display-wrap',
            '.post-position-wrap',
        ];
        for (const selector of selectors) {
            for (const el of Array.from(document.querySelectorAll(selector))) {
                if (!visible(el)) continue;
                fireClick(el);
                return {
                    clicked: true,
                    selector,
                    text: textOf(el),
                    className: String(el.className || ''),
                    html: String(el.outerHTML || '').slice(0, 1000),
                };
            }
        }
        return { clicked: false };
    }"""
    attempts = []
    for context_name, context in get_contexts(page):
        try:
            result = context.evaluate(script)
            attempts.append({
                "context": context_name,
                "url": str(getattr(context, "url", "")),
                "result": result,
            })
            if result and result.get("clicked"):
                page.wait_for_timeout(800)
                return attempts
        except Exception as exc:
            attempts.append({"context": context_name, "error": str(exc)})
    return attempts


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe WeChat Channels location DOM without publishing.")
    parser.add_argument("--payload", required=True)
    parser.add_argument("--log-path", default="")
    parser.add_argument("--hold-seconds", type=int, default=600)
    args = parser.parse_args()

    payload_path = Path(args.payload)
    payload = json.loads(payload_path.read_text(encoding="utf-8-sig"))
    user_data_dir = Path(payload["userDataDir"])
    video_path = Path(payload["videoPath"]).resolve()
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    log_path = Path(args.log_path) if args.log_path else (
        Path(__file__).resolve().parents[2]
        / "data"
        / "logs"
        / f"wechat_region_probe_{int(time.time())}.jsonl"
    )

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch_persistent_context(
            str(user_data_dir),
            headless=False,
            viewport={"width": 1440, "height": 960},
            accept_downloads=True,
        )
        try:
            page = browser.pages[0] if browser.pages else browser.new_page()
            ensure_logged_in(page, int(payload.get("loginTimeoutSec") or 600))
            upload_video(page, str(video_path))

            final_text = build_publish_text(payload)
            short_title = build_short_title(payload)
            if final_text:
                fill_publish_text(page, final_text)
            if short_title:
                fill_short_title(page, short_title)

            page.wait_for_timeout(1500)
            write_event(log_path, "before_open", {"url": page.url, "dom": dump_location_dom(page)})
            write_event(log_path, "open_attempt", {"attempts": click_location_display(page)})
            write_event(log_path, "after_open", {"url": page.url, "dom": dump_location_dom(page)})
            select_no_region(page)
            page.wait_for_timeout(1500)
            write_event(log_path, "after_select_no_region", {"url": page.url, "dom": dump_location_dom(page)})

            write_event(log_path, "holding", {"seconds": args.hold_seconds, "logPath": str(log_path)})
            deadline = time.time() + max(0, args.hold_seconds)
            while time.time() < deadline:
                page.wait_for_timeout(1000)
        finally:
            try:
                browser.close()
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
