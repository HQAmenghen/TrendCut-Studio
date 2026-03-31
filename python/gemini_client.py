import os
import time
import sys

from google import genai


DEFAULT_TIMEOUT_SECONDS = 180
DEFAULT_GENERATE_RETRIES = 3
RETRYABLE_ERROR_MARKERS = (
    "server disconnected without sending a response",
    "connection reset",
    "timed out",
    "timeout",
    "temporarily unavailable",
    "502",
    "503",
    "504",
)


def get_gemini_api_key() -> str:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "Missing Gemini API key. Set GEMINI_API_KEY or GOOGLE_API_KEY in your environment or .env file."
        )
    return api_key


def get_gemini_base_url() -> str | None:
    base_url = (
        os.getenv("GEMINI_API_BASE_URL")
        or os.getenv("GOOGLE_API_BASE_URL")
        or os.getenv("GEMINI_BASE_URL")
    )
    return str(base_url or "").strip() or None


def create_gemini_client() -> genai.Client:
    base_url = get_gemini_base_url()
    if base_url:
        return genai.Client(
            api_key=get_gemini_api_key(),
            http_options={"base_url": base_url},
        )
    return genai.Client(api_key=get_gemini_api_key())


def _is_retryable_error(exc: Exception) -> bool:
    message = str(exc or "").lower()
    return any(marker in message for marker in RETRYABLE_ERROR_MARKERS)


def generate_content(
    client: genai.Client,
    *,
    model: str,
    contents,
    response_mime_type: str | None = None,
    retries: int = DEFAULT_GENERATE_RETRIES,
):
    config = None
    if response_mime_type:
        config = {"response_mime_type": response_mime_type}
    last_error = None
    attempts = max(1, int(retries or 1))
    for attempt in range(1, attempts + 1):
        try:
            return client.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
        except Exception as exc:
            last_error = exc
            should_retry = attempt < attempts and _is_retryable_error(exc)
            if not should_retry:
                raise
            wait_seconds = min(6, attempt * 2)
            print(
                f"[gemini_client] generate_content attempt {attempt}/{attempts} failed, retrying in {wait_seconds}s: {exc}",
                file=sys.stderr,
                flush=True,
            )
            time.sleep(wait_seconds)
    if last_error:
        raise last_error


def upload_file(client: genai.Client, file_path: str, retries: int = 3):
    """上传文件到 Gemini，支持重试

    注意：如果文件名包含非ASCII字符，会创建临时符号链接
    """
    import tempfile
    import shutil
    from pathlib import Path

    last_error = None
    attempts = max(1, int(retries or 1))
    temp_link = None

    # 检查文件名是否包含非ASCII字符
    file_name = os.path.basename(file_path)
    try:
        file_name.encode('ascii')
        use_temp_link = False
    except UnicodeEncodeError:
        use_temp_link = True
        # 创建临时文件名（只保留扩展名）
        ext = os.path.splitext(file_name)[1]
        temp_name = f"temp_upload_{int(time.time() * 1000)}{ext}"
        temp_link = os.path.join(tempfile.gettempdir(), temp_name)

        print(
            f"[gemini_client] 文件名包含非ASCII字符，创建临时链接: {temp_name}",
            file=sys.stderr,
            flush=True,
        )

        # 在Windows上使用复制而不是符号链接
        try:
            shutil.copy2(file_path, temp_link)
            file_path = temp_link
        except Exception as e:
            print(
                f"[gemini_client] 创建临时文件失败: {e}",
                file=sys.stderr,
                flush=True,
            )
            use_temp_link = False

    try:
        for attempt in range(1, attempts + 1):
            try:
                print(f"[gemini_client] 正在上传文件 (尝试 {attempt}/{attempts})...", file=sys.stderr, flush=True)
                result = client.files.upload(file=file_path)
                print(f"[gemini_client] 文件上传成功: {result.name}", file=sys.stderr, flush=True)
                return result
            except Exception as exc:
                last_error = exc
                should_retry = attempt < attempts and _is_retryable_error(exc)

                print(
                    f"[gemini_client] 文件上传失败 (尝试 {attempt}/{attempts}): {exc}",
                    file=sys.stderr,
                    flush=True,
                )

                if not should_retry:
                    raise RuntimeError(f"文件上传失败 (已尝试 {attempt} 次): {exc}") from exc

                wait_seconds = min(10, attempt * 3)
                print(
                    f"[gemini_client] {wait_seconds}秒后重试...",
                    file=sys.stderr,
                    flush=True,
                )
                time.sleep(wait_seconds)

        if last_error:
            raise RuntimeError(f"文件上传失败 (已尝试 {attempts} 次): {last_error}") from last_error

    finally:
        # 清理临时文件
        if use_temp_link and temp_link and os.path.exists(temp_link):
            try:
                os.unlink(temp_link)
                print(
                    f"[gemini_client] 已清理临时文件",
                    file=sys.stderr,
                    flush=True,
                )
            except Exception as e:
                print(
                    f"[gemini_client] 清理临时文件失败: {e}",
                    file=sys.stderr,
                    flush=True,
                )


def get_file_state_name(file_ref) -> str:
    state = getattr(file_ref, "state", None)
    if hasattr(state, "name"):
        return str(state.name or "").upper()
    return str(state or "").upper()


def wait_for_file_ready(client: genai.Client, file_ref, *, poll_seconds: int = 3, timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS):
    started_at = time.time()
    current = file_ref
    while True:
        state_name = get_file_state_name(current)
        if state_name and state_name not in {"PROCESSING", "STATE_UNSPECIFIED"}:
            return current
        if time.time() - started_at >= timeout_seconds:
            raise TimeoutError(f"Timed out waiting for Gemini file processing: {getattr(current, 'name', '')}")
        time.sleep(max(1, int(poll_seconds)))
        current = client.files.get(name=current.name)


def delete_file(client: genai.Client, file_name: str) -> None:
    if not file_name:
        return
    client.files.delete(name=file_name)
