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


def create_gemini_client() -> genai.Client:
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


def upload_file(client: genai.Client, file_path: str):
    return client.files.upload(file=file_path)


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
