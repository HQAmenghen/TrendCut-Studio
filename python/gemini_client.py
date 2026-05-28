import os
import time
import sys

from google import genai
import threading
import itertools


DEFAULT_TIMEOUT_SECONDS = 180
DEFAULT_GENERATE_RETRIES = 5
RETRYABLE_ERROR_MARKERS = (
    "server disconnected without sending a response",
    "connection reset",
    "connection aborted",
    "remote end closed connection without response",
    "timed out",
    "timeout",
    "temporarily unavailable",
    "502",
    "503",
    "504",
)


def _env_int(name: str, default: int) -> int:
    value = str(os.getenv(name) or "").strip()
    if not value:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _resolve_generate_attempts(requested_retries: int | None) -> int:
    requested = 1
    try:
        requested = int(requested_retries or 1)
    except (TypeError, ValueError):
        requested = 1
    minimum = _env_int("GEMINI_GENERATE_MIN_RETRIES", DEFAULT_GENERATE_RETRIES)
    return max(1, requested, minimum)


def _is_vertex_mode() -> bool:
    return os.getenv("LLM_PROVIDER", "").lower() == "vertex"


def _get_vertex_auth_mode() -> str:
    mode = str(os.getenv("VERTEX_AI_AUTH_MODE") or "").strip().lower()
    if mode in {"api_key", "apikey", "key", "express"}:
        return "api_key"
    return "adc"


def _get_vertex_api_key() -> str:
    return str(
        os.getenv("VERTEX_AI_API_KEY")
        or os.getenv("GOOGLE_API_KEY")
        or os.getenv("GEMINI_API_KEY")
        or ""
    ).strip()


def get_gemini_api_keys() -> list[str]:
    """获取 Gemini API Key 列表，支持分号分隔"""
    raw_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not raw_key:
        if _is_vertex_mode():
            return []
        raise RuntimeError(
            "Missing Gemini API key. Set GEMINI_API_KEY or GOOGLE_API_KEY in your environment or .env file."
        )

    if ";" in raw_key:
        keys = [k.strip() for k in raw_key.split(";") if k.strip()]
    elif "," in raw_key:
        keys = [k.strip() for k in raw_key.split(",") if k.strip()]
    else:
        keys = [raw_key.strip()]

    return keys


def get_gemini_base_url() -> str | None:
    base_url = (
        os.getenv("GEMINI_API_BASE_URL")
        or os.getenv("GOOGLE_API_BASE_URL")
        or os.getenv("GEMINI_BASE_URL")
    )
    return str(base_url or "").strip() or None


class KeyRotator:
    """线程安全的 Key 轮询器"""
    def __init__(self, items: list):
        self.items = items
        self.cycle = itertools.cycle(items)
        self.lock = threading.Lock()
        self.count = len(items)

    def next(self):
        with self.lock:
            return next(self.cycle)


class GeminiPool:
    """Gemini 客户端池，支持多 Key 轮询"""
    def __init__(self, api_keys: list[str], base_url: str | None = None):
        self.api_keys = api_keys
        self.base_url = base_url
        self.clients = []
        for key in api_keys:
            if base_url:
                self.clients.append(genai.Client(
                    api_key=key,
                    http_options={"base_url": base_url},
                ))
            else:
                self.clients.append(genai.Client(api_key=key))
        
        self.rotator = KeyRotator(self.clients)
        # 固定主客户端用于文件操作（如上传视频），避免跨账号导致的 File Not Found
        self.primary_client = self.clients[0]

    def get_client(self, stateless: bool = True) -> genai.Client:
        """获取客户端。如果是无状态操作（如生成内容），则进行轮询；否则使用主客户端。"""
        if stateless and self.rotator.count > 1:
            return self.rotator.next()
        return self.primary_client


def create_gemini_client(vertex_mode: bool | None = None) -> genai.Client | GeminiPool:
    """创建 Gemini 客户端（支持池化和 Vertex AI）

    Args:
        vertex_mode: 显式指定是否使用 Vertex AI。None 时读取 LLM_PROVIDER 环境变量。
    """
    use_vertex = vertex_mode if vertex_mode is not None else _is_vertex_mode()

    # Vertex AI 模式：支持 API key 和 ADC/project-location 两种认证
    if use_vertex:
        if _get_vertex_auth_mode() == "api_key":
            api_key = _get_vertex_api_key()
            if not api_key:
                raise RuntimeError(
                    "Missing Vertex AI API key. Set VERTEX_AI_API_KEY, GOOGLE_API_KEY, or GEMINI_API_KEY in .env"
                )
            print(
                "[gemini_client] Vertex AI API key 模式",
                file=sys.stderr, flush=True,
            )
            # Vertex AI Express API keys use the standard developer backend
            # Do NOT pass vertexai=True, otherwise the SDK expects OAuth credentials.
            # Do NOT use GEMINI_API_BASE_URL here, because proxy servers typically
            # expect standard Gemini AI Studio keys ('sk-...') and will reject Vertex keys ('AQ...').
            # We must use the official Google endpoint.
            return genai.Client(
                api_key=api_key,
            )

        project = os.getenv("VERTEX_AI_PROJECT") or os.getenv("GCP_PROJECT")
        location = os.getenv("VERTEX_AI_LOCATION", "us-central1").strip()
        if not project:
            raise RuntimeError(
                "Missing VERTEX_AI_PROJECT. Set VERTEX_AI_PROJECT or GCP_PROJECT in .env"
            )
        print(
            f"[gemini_client] Vertex AI 模式: project={project}, location={location}",
            file=sys.stderr, flush=True,
        )
        return genai.Client(
            vertexai=True,
            project=project,
            location=location,
        )

    # 普通 Gemini API 模式
    base_url = get_gemini_base_url()
    api_keys = get_gemini_api_keys()

    if len(api_keys) > 1:
        return GeminiPool(api_keys=api_keys, base_url=base_url)

    if base_url:
        return genai.Client(
            api_key=api_keys[0],
            http_options={"base_url": base_url},
        )
    return genai.Client(api_key=api_keys[0])


def _is_retryable_error(exc: Exception) -> bool:
    message = str(exc or "").lower()
    return any(marker in message for marker in RETRYABLE_ERROR_MARKERS)


def generate_content(
    client: genai.Client | GeminiPool,
    *,
    model: str,
    contents,
    response_mime_type: str | None = None,
    retries: int = DEFAULT_GENERATE_RETRIES,
):
    # 如果是池化客户端，获取下一个可用实例进行内容生成（无状态操作）
    if isinstance(client, GeminiPool):
        effective_client = client.get_client(stateless=True)
    else:
        effective_client = client

    config = None
    if response_mime_type:
        config = {"response_mime_type": response_mime_type}
    last_error = None
    attempts = _resolve_generate_attempts(retries)
    for attempt in range(1, attempts + 1):
        try:
            return effective_client.models.generate_content(
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
                # 文件上传必须使用主客户端，以保证后续操作可见
                effective_client = client.primary_client if isinstance(client, GeminiPool) else client
                print(f"[gemini_client] 正在上传文件 (尝试 {attempt}/{attempts})...", file=sys.stderr, flush=True)
                result = effective_client.files.upload(file=file_path)
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
        effective_client = client.primary_client if isinstance(client, GeminiPool) else client
        current = effective_client.files.get(name=current.name)


def delete_file(client: genai.Client | GeminiPool, file_name: str) -> None:
    if not file_name:
        return
    effective_client = client.primary_client if isinstance(client, GeminiPool) else client
    effective_client.files.delete(name=file_name)
