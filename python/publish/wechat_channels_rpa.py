import argparse
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


CREATE_URL = "https://channels.weixin.qq.com/platform/post/create"


def emit(state: str, message: str, **extra) -> None:
    payload = json.dumps(extra, ensure_ascii=False) if extra else "{}"
    print(f"STATUS|{state}|{message}|{payload}", flush=True)


def emit_progress(state: str, message: str, percent: int, **extra) -> None:
    emit(state, message, percent=percent, **extra)


def log(message: str) -> None:
    print(f"LOG|{message}", flush=True)


def load_payload(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def get_contexts(page):
    contexts = [("main", page)]
    try:
        for index, frame in enumerate(page.frames):
            if frame == page.main_frame:
                continue
            contexts.append((f"frame[{index}] {frame.url}", frame))
    except Exception:
        pass
    return contexts


def get_publish_frame(page):
    for context_name, context in get_contexts(page):
        if context_name == "main":
            continue
        if "channels.weixin.qq.com/micro/content/post/create" in str(getattr(context, "url", "")):
            return context_name, context
    return None, None


def get_editor_contexts(page):
    frame_name, frame = get_publish_frame(page)
    if frame is not None:
        return [(frame_name, frame), ("main", page)]
    return get_contexts(page)


def is_create_page(page) -> bool:
    url = page.url or ""
    if "channels.weixin.qq.com/platform/post/create" in url:
        return True
    selectors = [
        'input[type="file"]',
        'button:has-text("发表")',
        'button:has-text("发布")',
        '[contenteditable="true"]',
        'textarea'
    ]
    for selector in selectors:
        try:
            if page.locator(selector).count() > 0:
                return True
        except Exception:
            continue
    return False


def wait_for_login(page, timeout_seconds: int) -> None:
    emit_progress("need_login", "请在打开的浏览器中扫码登录视频号助手", 15)
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            if is_create_page(page):
                emit_progress("login_ready", "检测到视频号助手已可用", 25)
                return
            page.wait_for_timeout(1500)
        except Exception:
            pass
    raise RuntimeError("等待扫码登录超时，请重新发起登录或检查登录状态。")


def goto_create(page) -> None:
    emit_progress("navigating", "正在打开视频号助手发布页", 8)
    page.goto(CREATE_URL, wait_until="domcontentloaded", timeout=120000)
    log(f"当前页面 URL: {page.url}")


def ensure_logged_in(page, timeout_seconds: int) -> None:
    goto_create(page)
    if not is_create_page(page):
        wait_for_login(page, timeout_seconds)
        goto_create(page)
    if not is_create_page(page):
        raise RuntimeError("登录后仍未进入发布页，请检查账号权限。")


def is_upload_ready(page) -> tuple[bool, str]:
    checks = [
        ('textarea[placeholder*="描述"]', '已出现描述输入框'),
        ('text=添加描述', '已出现描述占位提示'),
        ('text=视频描述', '已进入视频描述区'),
        ('text=封面预览', '已出现封面预览'),
        ('text=删除', '已出现视频删除按钮'),
        ('button:has-text("发表")', '已出现发表按钮'),
        ('button:has-text("发布")', '已出现发布按钮'),
        ('text=处理中', '视频上传后正在处理中'),
        ('text=上传完成', '页面提示上传完成')
    ]
    for context_name, context in get_contexts(page):
        for selector, reason in checks:
            try:
                locator = context.locator(selector).first
                if locator.count() > 0 and locator.is_visible():
                    return True, f"{reason} ({context_name})"
            except Exception:
                continue
    return False, ''


def upload_video(page, video_path: str) -> None:
    emit_progress("uploading", "正在上传视频文件", 40)
    file_input = page.locator('input[type="file"]').first
    file_input.set_input_files(video_path)
    emit_progress("processing", "视频已提交，正在等待页面进入可填写状态", 48)
    log(f"已提交视频文件: {video_path}")

    deadline = time.time() + 180
    while time.time() < deadline:
        ready, reason = is_upload_ready(page)
        if ready:
            log(f"上传完成判定命中: {reason}")
            emit_progress("uploaded", f"视频已上传，{reason}", 58)
            return
        page.wait_for_timeout(1200)

    page.wait_for_timeout(3000)
    log("上传等待超时，改为继续尝试填写内容")
    emit_progress("uploaded", "未捕获到明确上传完成提示，继续尝试填写内容", 58)


def build_publish_text(payload: dict) -> str:
    description = str(payload.get("description") or "").strip()
    tags = payload.get("tags") or []
    normalized_tags = []
    for tag in tags:
        text = str(tag).strip().replace("#", "")
        if text:
            normalized_tags.append(f"#{text}")

    description_lower = description.lower()
    appendable_tags = []
    for tag in normalized_tags:
        if tag.lower() not in description_lower:
            appendable_tags.append(tag)

    parts = [part for part in [description, " ".join(appendable_tags)] if part]
    return "\n\n".join(parts).strip()


def build_short_title(payload: dict) -> str:
    short_title = str(payload.get("shortTitle") or "").strip()
    if short_title:
        return short_title[:16]
    title = str(payload.get("title") or "").strip()
    normalized = title.replace("\n", " ").replace("\r", " ").strip()
    if len(normalized) <= 16:
        return normalized
    return normalized[:16].strip()


def activate_description_area(page) -> None:
    activation_selectors = [
        'text=添加描述',
        'text=视频描述',
        '.input-editor',
        '[class*="post-desc"]',
        '[class*="description"]',
        '[role="textbox"]'
    ]
    for context_name, context in get_editor_contexts(page):
        for selector in activation_selectors:
            try:
                locator = context.locator(selector).first
                if locator.count() == 0:
                    continue
                locator.click(timeout=2000)
                page.wait_for_timeout(500)
                log(f"已尝试激活描述区域，选择器: {selector}，上下文: {context_name}")
                return
            except Exception:
                continue
    log("未命中显式的描述区域激活入口")


def log_active_element(page, prefix: str) -> None:
    for context_name, context in get_contexts(page):
        try:
            info = context.evaluate(
                """() => {
                    const el = document.activeElement;
                    if (!el) return null;
                    return {
                    tag: el.tagName,
                    type: el.getAttribute?.('type') || '',
                    className: el.className || '',
                    placeholder: el.getAttribute?.('placeholder') || '',
                    ariaLabel: el.getAttribute?.('aria-label') || '',
                    contenteditable: el.getAttribute?.('contenteditable') || '',
                };
                }"""
            )
            if info:
                log(f"{prefix} [{context_name}]: {info}")
        except Exception as exc:
            log(f"{prefix} [{context_name}] 失败: {exc}")


def _score_active_element_info(info) -> int:
    if not info:
        return -1
    tag = str(info.get("tag") or "").upper()
    input_type = str(info.get("type") or "").lower()
    class_name = str(info.get("className") or "")
    contenteditable = str(info.get("contenteditable") or "").lower()
    score = 0
    if tag in {"TEXTAREA", "INPUT"}:
        score += 10
    if tag == "INPUT" and input_type in {"radio", "checkbox"}:
        score -= 8
    if contenteditable == "true":
        score += 10
    if "input-editor" in class_name:
        score += 9
    if tag == "BODY":
        score -= 5
    if tag == "WUJIE-APP":
        score -= 4
    if info.get("value") or info.get("innerText"):
        score += 2
    return score


def get_active_element_info(page):
    best = None
    best_score = -999
    for context_name, context in get_contexts(page):
        try:
            info = context.evaluate(
                """() => {
                    const el = document.activeElement;
                    if (!el) return null;
                    return {
                        tag: el.tagName,
                        type: el.getAttribute?.('type') || '',
                        className: el.className || '',
                        placeholder: el.getAttribute?.('placeholder') || '',
                        ariaLabel: el.getAttribute?.('aria-label') || '',
                        contenteditable: el.getAttribute?.('contenteditable') || '',
                        value: 'value' in el ? String(el.value || '') : '',
                        innerText: String(el.innerText || '')
                    };
                }"""
            )
            if info:
                info["context"] = context_name
                score = _score_active_element_info(info)
                if score > best_score:
                    best = info
                    best_score = score
        except Exception:
            continue
    return best


def is_editable_active_element(page) -> bool:
    try:
        info = get_active_element_info(page)
        if not info:
            return False
        tag = str(info.get("tag") or "").upper()
        input_type = str(info.get("type") or "").lower()
        class_name = str(info.get("className") or "")
        contenteditable = str(info.get("contenteditable") or "").lower()
        if tag == "INPUT" and input_type in {"radio", "checkbox"}:
            return False
        return tag in {"TEXTAREA", "INPUT"} or contenteditable == "true" or "input-editor" in class_name
    except Exception:
        return False


def verify_content_written(page, content: str) -> bool:
    needle = str(content or "").strip().replace("\r", "").split("\n")[0][:12]
    if not needle:
        return True
    try:
        info = get_active_element_info(page)
        haystack = f"{info.get('value', '')}\n{info.get('innerText', '')}" if info else ""
        if needle in haystack:
            log(f"已在 activeElement 中验证到文案片段: {needle}")
            return True
    except Exception:
        pass
    log(f"未验证到文案片段写入成功: {needle}")
    return False


def verify_locator_written(locator, content: str) -> bool:
    needle = str(content or "").strip()[:8]
    if not needle:
        return True
    try:
        value = locator.input_value()
        if needle in str(value):
            return True
    except Exception:
        pass
    try:
        text_content = locator.text_content()
        if needle in str(text_content or ''):
            return True
    except Exception:
        pass
    return False


def try_focus_and_type_without_locator(page, content: str) -> bool:
    anchor_texts = ["添加描述", "视频描述", "描述"]
    for context_name, context in get_editor_contexts(page):
        for text in anchor_texts:
            try:
                context.get_by_text(text, exact=False).first.click(timeout=2000)
                page.wait_for_timeout(500)
                log_active_element(page, f"点击 {text} 后的 activeElement")

                initial_info = get_active_element_info(page)
                if is_editable_active_element(page):
                    log(f"点击 {text} 后立即命中可编辑 activeElement: {initial_info}")
                    page.keyboard.press("Control+A")
                    page.keyboard.press("Backspace")
                    page.keyboard.insert_text(content)
                    page.wait_for_timeout(1000)
                    if verify_content_written(page, content):
                        log(f"通过锚点 {text} 的即时焦点输入成功，上下文: {context_name}")
                        return True
                    log(f"通过锚点 {text} 的即时焦点输入未验证成功，继续 Tab 尝试")

                for step in range(3):
                    try:
                        page.keyboard.press("Tab")
                        page.wait_for_timeout(250)
                        log_active_element(page, f"{text} 后第 {step + 1} 次 Tab 的 activeElement")
                        info = get_active_element_info(page)
                        if is_editable_active_element(page):
                            log(f"锚点 {text} 后第 {step + 1} 次 Tab 命中可编辑 activeElement: {info}")
                            page.keyboard.press("Control+A")
                            page.keyboard.press("Backspace")
                            page.keyboard.insert_text(content)
                            page.wait_for_timeout(1000)
                            if verify_content_written(page, content):
                                log(f"通过锚点 {text} 的 Tab 焦点输入成功，上下文: {context_name}")
                                return True
                            log(f"通过锚点 {text} 的 Tab 焦点输入未验证成功，停止继续 Tab")
                            break
                    except Exception:
                        break

                info = get_active_element_info(page)
                if not is_editable_active_element(page):
                    log(f"锚点 {text} 后 activeElement 不可编辑，跳过键盘输入，上下文: {context_name}，info={info}")
                    continue
                log(f"锚点 {text} 后命中可编辑 activeElement: {info}")
                page.keyboard.press("Control+A")
                page.keyboard.press("Backspace")
                page.keyboard.insert_text(content)
                page.wait_for_timeout(1000)
                if verify_content_written(page, content):
                    log(f"通过锚点 {text} 的焦点兜底输入成功，上下文: {context_name}")
                    return True
                log(f"通过锚点 {text} 输入后未验证到文案，继续尝试其他方式，上下文: {context_name}")
            except Exception as exc:
                log(f"通过锚点 {text} 的焦点兜底输入失败，上下文: {context_name}: {exc}")
                continue
    return False


def find_description_editor(page):
    activate_description_area(page)
    direct_selectors = ['.input-editor']
    for context_name, context in get_editor_contexts(page):
        for selector in direct_selectors:
            locator = context.locator(selector)
            count = locator.count()
            log(f"检查主路径选择器 {selector}，候选数量: {count}，上下文: {context_name}")
            for index in range(count):
                candidate = locator.nth(index)
                try:
                    candidate.wait_for(timeout=1500, state="attached")
                    visible = candidate.is_visible()
                    box = candidate.bounding_box()
                    log(f"命中主路径候选 {selector}[{index}]，visible={visible}，尺寸={box}，上下文: {context_name}")
                    if visible or box:
                        return candidate
                except Exception:
                    continue

    selectors = [
        'textarea',
        '[role="textbox"][aria-label*="描述"]'
    ]
    for context_name, context in get_editor_contexts(page):
        for selector in selectors:
            locator = context.locator(selector)
            count = locator.count()
            log(f"检查选择器 {selector}，候选数量: {count}，上下文: {context_name}")
            for index in range(count):
                candidate = locator.nth(index)
                try:
                    candidate.wait_for(timeout=1500, state="attached")
                    visible = candidate.is_visible()
                    box = candidate.bounding_box()
                    placeholder = candidate.get_attribute("placeholder") or candidate.get_attribute("aria-label") or ""
                    log(f"命中候选 {selector}[{index}]，visible={visible}，尺寸={box}，placeholder={placeholder}，上下文: {context_name}")
                    placeholder_text = str(placeholder or '')
                    if any(token in placeholder_text for token in ["商品链接", "链接", "识别后即可添加对应商品", "最多30个链接"]):
                        log(f"跳过非描述输入框 {selector}[{index}]，placeholder={placeholder_text}，上下文: {context_name}")
                        continue
                    if visible:
                        return candidate
                    if box and box["width"] >= 120 and box["height"] >= 20:
                        return candidate
                except PlaywrightTimeoutError:
                    continue
                except Exception:
                    continue

    placeholder_texts = ["添加描述", "视频描述", "描述"]
    for context_name, context in get_editor_contexts(page):
        for text in placeholder_texts:
            try:
                log(f"尝试通过文本锚点点击: {text}，上下文: {context_name}")
                context.get_by_text(text, exact=False).first.click(timeout=2000)
                page.wait_for_timeout(800)
                locator = context.locator('.input-editor, textarea, [role="textbox"]')
                count = locator.count()
                log(f"文本锚点 {text} 后的候选数量: {count}，上下文: {context_name}")
                for index in range(count):
                    candidate = locator.nth(index)
                    try:
                        candidate.wait_for(timeout=1500, state="attached")
                        visible = candidate.is_visible()
                        box = candidate.bounding_box()
                        log(f"文本锚点候选[{index}] visible={visible} box={box}，上下文: {context_name}")
                        if visible or box:
                            log(f"通过文本锚点 {text} 找到输入框，上下文: {context_name}")
                            return candidate
                    except Exception:
                        continue
            except Exception:
                continue

    return None


def find_short_title_input(page):
    selectors = [
        'input[placeholder*="概括视频主要内容"]',
        'input[placeholder*="字数建议"]',
        'input[placeholder*="短标题"]'
    ]
    for context_name, context in get_editor_contexts(page):
        for selector in selectors:
            locator = context.locator(selector)
            count = locator.count()
            log(f"检查短标题选择器 {selector}，候选数量: {count}，上下文: {context_name}")
            for index in range(count):
                candidate = locator.nth(index)
                try:
                    candidate.wait_for(timeout=1500, state="attached")
                    visible = candidate.is_visible()
                    placeholder = candidate.get_attribute("placeholder") or ""
                    log(f"命中短标题候选 {selector}[{index}]，visible={visible}，placeholder={placeholder}，上下文: {context_name}")
                    if visible:
                        return candidate
                except Exception:
                    continue
    return None


def fill_publish_text(page, content: str) -> None:
    emit_progress("editing", "正在填写描述和话题", 72)
    locator = find_description_editor(page)
    if locator is None:
        log("未找到显式描述输入框，尝试使用焦点兜底输入")
        if try_focus_and_type_without_locator(page, content):
            emit_progress("edited", "通过焦点兜底完成内容填写", 86)
            return
        log("焦点兜底仍失败，准备抛出异常")
        raise RuntimeError("未找到可填写的描述输入框，页面结构可能已变化。")

    clicked = False
    try:
        if locator.is_visible():
            locator.click(timeout=3000)
            clicked = True
            page.wait_for_timeout(400)
            log("已点击描述输入框，开始尝试填写")
    except Exception as exc:
        log(f"点击描述输入框失败，改为直接写值: {exc}")

    filled = False
    try:
        locator.fill(content)
        if verify_content_written(page, content):
            filled = True
            log("使用 locator.fill 填写成功")
        else:
            log("locator.fill 已执行，但未验证到文案写入")
    except Exception:
        pass

    if not filled:
        try:
            if not clicked:
                if locator.is_visible():
                    try:
                        locator.click(force=True, timeout=1000)
                    except Exception:
                        pass
            if not is_editable_active_element(page):
                raise RuntimeError("当前焦点不是可编辑输入区")
            page.keyboard.press("Control+A")
            page.keyboard.press("Backspace")
            page.keyboard.insert_text(content)
            if verify_content_written(page, content):
                filled = True
                log("使用键盘输入填写成功")
            else:
                log("键盘输入已执行，但未验证到文案写入")
        except Exception:
            pass

    if not filled:
        try:
            locator.evaluate(
                """(node, value) => {
                    const text = String(value || '');
                    if ('value' in node) node.value = text;
                    if (node.isContentEditable) node.innerText = text;
                    node.dispatchEvent(new Event('input', { bubbles: true }));
                    node.dispatchEvent(new Event('change', { bubbles: true }));
                    node.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
                }""",
                content
            )
            if verify_content_written(page, content):
                filled = True
                log("使用 DOM evaluate 填写成功")
            else:
                log("DOM evaluate 已执行，但未验证到文案写入")
        except Exception:
            pass

    if not filled:
        try:
            page.evaluate(
                """(value) => {
                    const text = String(value || '');
                    const nodes = Array.from(document.querySelectorAll('textarea, [role="textbox"], [contenteditable="true"]'));
                    for (const node of nodes) {
                        if ('value' in node) node.value = text;
                        if (node.isContentEditable) node.innerText = text;
                        node.dispatchEvent(new Event('input', { bubbles: true }));
                        node.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }""",
                content
            )
            if verify_content_written(page, content):
                filled = True
                log("使用页面级批量回填成功")
            else:
                log("页面级批量回填已执行，但未验证到文案写入")
        except Exception:
            pass

    if not filled:
        log("所有填写方式均失败")
        raise RuntimeError("已找到描述输入框，但自动填写失败。")

    page.wait_for_timeout(1200)
    emit_progress("edited", "发布内容已填充完成", 86)


def fill_short_title(page, short_title: str) -> None:
    normalized = str(short_title or "").strip()
    if not normalized:
        log("短标题为空，跳过填写")
        return
    emit_progress("editing", "正在填写短标题", 90)
    locator = find_short_title_input(page)
    if locator is None:
        log("未找到短标题输入框，跳过短标题填写")
        return

    filled = False
    try:
        locator.click(timeout=2000)
    except Exception:
        pass

    try:
        locator.fill(normalized)
        if verify_locator_written(locator, normalized):
            filled = True
            log(f"短标题填写成功: {normalized}")
    except Exception:
        pass

    if not filled:
        try:
            locator.click(force=True, timeout=1000)
            page.keyboard.press("Control+A")
            page.keyboard.press("Backspace")
            page.keyboard.insert_text(normalized)
            if verify_locator_written(locator, normalized):
                filled = True
                log(f"短标题键盘输入成功: {normalized}")
        except Exception:
            pass

    if not filled:
        log("未验证到短标题写入成功，保留页面供人工处理")
    page.wait_for_timeout(600)

def _is_checkbox_checked(locator) -> bool | None:
    try:
        checked = locator.is_checked()
        return bool(checked)
    except Exception:
        pass
    try:
        value = locator.get_attribute("aria-checked")
        if value is not None:
            return value.lower() == "true"
    except Exception:
        pass
    try:
        value = locator.get_attribute("checked")
        if value is not None:
            return True
    except Exception:
        pass
    return None


def _find_first_visible(page, selectors: list[str]):
    for context_name, context in get_editor_contexts(page):
        for selector in selectors:
            try:
                locator = context.locator(selector).first
                if locator.count() == 0:
                    continue
                locator.wait_for(timeout=2000, state="visible")
                return context_name, context, selector, locator
            except Exception:
                continue
    return None, None, None, None


def _ensure_checkbox_checked(locator) -> bool:
    checked = _is_checkbox_checked(locator)
    if checked is True:
        return True
    try:
        locator.check(force=True, timeout=2000)
    except Exception:
        try:
            locator.click(force=True, timeout=2000)
        except Exception:
            try:
                locator.locator('xpath=ancestor::label[1]').click(timeout=2000)
            except Exception:
                return False
    return _is_checkbox_checked(locator) is True


def confirm_original_declaration_dialog(page) -> bool:
    dialog_selectors = [
        '.declare-original-dialog .weui-desktop-dialog',
        '.declare-original-dialog',
        'text=原创权益'
    ]
    _, context, selector, dialog = _find_first_visible(page, dialog_selectors)
    if dialog is None:
        log("未检测到原创声明弹窗，视为无需二次确认")
        return True

    log(f"检测到原创声明弹窗，选择器: {selector}")

    protocol_checkbox_selectors = [
        '.declare-original-dialog .original-proto-wrapper .ant-checkbox-input',
        '.declare-original-dialog label.ant-checkbox-wrapper .ant-checkbox-input',
        '.original-proto-wrapper .ant-checkbox-input'
    ]
    _, _, checkbox_selector, checkbox = _find_first_visible(page, protocol_checkbox_selectors)
    if checkbox is None:
        raise RuntimeError("检测到原创声明弹窗，但未找到协议勾选框。")

    if not _ensure_checkbox_checked(checkbox):
        raise RuntimeError("原创声明弹窗中的协议勾选框未能成功勾选。")
    log(f"原创声明弹窗协议已勾选，选择器: {checkbox_selector}")
    page.wait_for_timeout(400)

    confirm_button_selectors = [
        '.declare-original-dialog button.weui-desktop-btn_primary:has-text("声明原创")',
        'button.weui-desktop-btn_primary:has-text("声明原创")',
        'button:has-text("声明原创")'
    ]
    _, _, button_selector, button = _find_first_visible(page, confirm_button_selectors)
    if button is None:
        raise RuntimeError("检测到原创声明弹窗，但未找到“声明原创”确认按钮。")

    button.click(timeout=2000)
    log(f"已点击原创声明弹窗确认按钮，选择器: {button_selector}")
    page.wait_for_timeout(1200)
    return True


def enable_original_declaration(page, enabled: bool) -> None:
    if not enabled:
        log("原创声明开关未启用，跳过勾选")
        return

    emit_progress("editing", "正在尝试勾选原创声明", 92)
    checkbox_selectors = [
        '.declare-original-checkboxbox .ant-checkbox-input',
        'label.ant-checkbox-wrapper .ant-checkbox-input',
        'input.ant-checkbox-input[type="checkbox"]'
    ]
    trigger_selectors = [
        '.declare-original-checkboxbox label.ant-checkbox-wrapper',
        '.declare-original-checkboxbox .ant-checkbox',
        'label:has-text("声明原创")',
        'label:has-text("原创声明")'
    ]

    context_name, _, checkbox_selector, checkbox = _find_first_visible(page, checkbox_selectors)
    if checkbox is None:
        log("未找到声明原创复选框，跳过该步骤并保留页面供人工处理")
        return

    if _is_checkbox_checked(checkbox) is True:
        log(f"原创声明已处于勾选状态，选择器: {checkbox_selector}，上下文: {context_name}")
        emit_progress("edited", "原创声明已勾选", 93)
        return

    clicked = False
    for selector in trigger_selectors:
        try:
            trigger = page.locator(selector).first
            if trigger.count() == 0:
                continue
            trigger.wait_for(timeout=1500, state="visible")
            trigger.click(timeout=2000)
            clicked = True
            log(f"已点击原创声明入口，选择器: {selector}")
            break
        except Exception:
            continue

    if not clicked:
        if not _ensure_checkbox_checked(checkbox):
            log("未能点击或勾选声明原创复选框，跳过该步骤并保留页面供人工处理")
            return

    page.wait_for_timeout(800)
    confirm_original_declaration_dialog(page)

    checkbox = page.locator(checkbox_selectors[0]).first
    if checkbox.count() > 0 and _is_checkbox_checked(checkbox) is True:
        log("已自动完成原创声明勾选与弹窗确认")
        emit_progress("edited", "已自动勾选原创声明", 93)
        return

    log("原创声明流程已执行，但未验证到最终勾选状态，请人工确认")


def click_publish(page, publish_mode: str) -> None:
    if publish_mode == "draft":
        emit_progress("ready_for_manual_publish", "已完成自动上传与填写，停留在待发布页供人工确认", 100)
        return

    emit_progress("publishing", "正在尝试点击发表按钮", 94)
    selectors = [
        'button:has-text("发表")',
        'button:has-text("发布")',
        'button:has-text("立即发布")'
    ]
    
    # 增加对按钮“可用性”的严谨判定（封面生成、视频处理都需要时间）
    deadline = time.time() + 120  # 最多等待2分钟
    while time.time() < deadline:
        for selector in selectors:
            try:
                for context_name, context in get_editor_contexts(page):
                    locator = context.locator(selector)
                    count = locator.count()
                    if count == 0:
                        continue
                        
                    for index in range(count):
                        button = locator.nth(index)
                        if not button.is_visible():
                            continue
                            
                        # 获取更多信息辅助调试
                        attr_info = button.evaluate("""el => ({
                            tag: el.tagName,
                            text: el.innerText,
                            disabled: el.disabled,
                            classList: Array.from(el.classList),
                            opacity: window.getComputedStyle(el).opacity,
                            pointerEvents: window.getComputedStyle(el).pointerEvents
                        })""")
                        
                        classList = attr_info.get("classList") or []
                        is_disabled_attr = attr_info.get("disabled") is True
                        has_disabled_class = any("disabled" in c.lower() for c in classList)
                        is_low_opacity = float(attr_info.get("opacity") or 1.0) < 0.5
                        
                        log(f"发现候选项 {selector}[{index}] (上下文: {context_name}): tag={attr_info['tag']}, disabled={is_disabled_attr}, classes={classList}, opacity={attr_info['opacity']}")
                        
                        # 判定逻辑：如果没有明显的 disabled 属性
                        # 我们按照用户建议采取“更积极”的策略：只要按钮不是 HTML 层面的禁选且看起来不是半透明
                        if not is_disabled_attr and not is_low_opacity:
                            log(f"发现可用发表按钮 (状态: ready)，开始点击策略 (上下文: {context_name})")
                            button.click()
                            
                            # 点击后只给 3.5 秒的响应窗口，在这期间如果不成功我们就重试
                            wait_deadline = time.time() + 3.5
                            while time.time() < wait_deadline:
                                page.wait_for_timeout(500)
                                # 1. 检查是否出现了表示拦截的弹窗文字，如果有，直接提前判定为失败并中断等待
                                try:
                                    tips = context.locator('.weui-desktop-msg-growl, .ant-message, .weui-desktop-popover, .weui-desktop-dialog').all()
                                    for t in tips:
                                        if t.is_visible():
                                            txt = t.inner_text()
                                            if any(k in txt for k in ["处理中", "请上传视频", "解析中", "上传中", "请完善", "提示", "失败", "封面"]):
                                                log(f"点击后收到拦截提示: '{txt}'，判定点击无效")
                                                wait_deadline = 0 # 终止内部等待循环
                                                break
                                except: pass
                                
                                # 2. 检查是否成功（跳转或者成功文案）
                                if "list" in page.url or context.locator('text=发表成功').count() > 0:
                                    log("识别到成功信号，发布流程完成")
                                    emit_progress("success", "已成功发表", 100)
                                    return
                            
                            # 3. 如果经过等待，发表按钮仍然可见且可用，说明需要继续点
                            try:
                                if button.count() > 0 and button.is_visible():
                                    log("按钮依然存在，将执行下一轮尝试...")
                            except: pass
                            continue # 进入下一轮寻找按钮的逻辑
                        else:
                            log(f"候选项状态不满足点击条件: disabled={is_disabled_attr}, opacity={is_low_opacity}")
            except Exception as e:
                log(f"检查发表按钮时出错 (选择器 {selector}): {e}")
                continue
        page.wait_for_timeout(3000)
        log("所有已知的发表按钮候选项均未就绪，继续等待...")

    raise RuntimeError("等待发表按钮就绪超时，请检查视频状态或手动处理。")


def wait_for_publish_result(page) -> bool:
    """等待并验证发布结果"""
    log("正在通过页面状态验证发布结果...")
    deadline = time.time() + 30
    while time.time() < deadline:
        url = page.url or ""
        # 如果跳转到了内容管理列表页，说明发布成功
        if "channels.weixin.qq.com/platform/post/list" in url:
            log("页面已跳转至作品列表，判定发布成功")
            return True
        # 检查成功提示文字
        for context_name, context in get_contexts(page):
            if context.locator('text=发表成功').count() > 0 or context.locator('text=已发表').count() > 0:
                log(f"检测到成功提示文字，判定发布成功 (上下文: {context_name})")
                return True
        page.wait_for_timeout(2000)
    return False


def wait_for_manual_close(browser) -> None:
    log("操控模式已完成，浏览器将保持打开，等待你手动关闭窗口")
    while True:
        try:
            if len(browser.pages) == 0:
                log("检测到浏览器页面已关闭，结束操控模式等待")
                return
            time.sleep(1)
        except Exception:
            return


def main() -> int:
    parser = argparse.ArgumentParser(description="WeChat Channels helper RPA")
    parser.add_argument("--payload", required=True, help="Payload json path")
    args = parser.parse_args()

    payload = load_payload(Path(args.payload))
    user_data_dir = Path(payload["userDataDir"])
    video_path = Path(payload["videoPath"]).resolve()
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    publish_mode = str(payload.get("publishMode") or "draft").strip()
    headless = bool(payload.get("headless", False))
    login_timeout = int(payload.get("loginTimeoutSec") or 180)
    original_declaration = bool(payload.get("originalDeclaration", True))
    final_text = build_publish_text(payload)
    short_title = build_short_title(payload)

    p = sync_playwright().start()
    browser = p.chromium.launch_persistent_context(
            str(user_data_dir),
            headless=headless,
            viewport={"width": 1440, "height": 960},
            accept_downloads=True,
    )
    try:
        page = browser.pages[0] if browser.pages else browser.new_page()
        try:
            emit_progress("starting", "正在准备视频号自动化流程", 3)
            ensure_logged_in(page, login_timeout)
            upload_video(page, str(video_path))
            if final_text:
                fill_publish_text(page, final_text)
            if short_title:
                fill_short_title(page, short_title)
            enable_original_declaration(page, original_declaration)
            click_publish(page, publish_mode)
            
            if publish_mode == "publish":
                # 对于直接发布的模式，增加结果验证
                success = wait_for_publish_result(page)
                if success:
                    emit_progress("success", "视频号流程圆满完成，内容已发表", 100)
                    log("已检测到发布成功，准备自动关闭浏览器")
                else:
                    log("未检测到明确的发布成功状态，将保持浏览器开启供检查")
                    wait_for_manual_close(browser)
            else:
                # 草稿模式
                page.wait_for_timeout(1500)
                wait_for_manual_close(browser)
            return 0
        finally:
            if publish_mode == "publish":
                log("视频号自动发布流程结束，浏览器将自动关闭")
            else:
                log("浏览器保持打开，便于人工检查页面状态")
    finally:
        try:
            if "browser" in locals() and browser:
                browser.close()
            p.stop()
        except Exception:
            pass


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        emit_progress("failed", str(exc), 100)
        raise
