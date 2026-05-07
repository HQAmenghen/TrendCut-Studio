"""
Vertex AI 客户端
通过 Google Cloud Vertex AI 调用 Gemini 模型
"""
import os
import sys
import time
from typing import Any

try:
    import vertexai
    from vertexai.generative_models import GenerativeModel, Part, Content
    VERTEX_AI_AVAILABLE = True
except ImportError:
    VERTEX_AI_AVAILABLE = False
    print("警告: vertexai 包未安装，无法使用 Vertex AI", file=sys.stderr)


DEFAULT_GENERATE_RETRIES = 3
RETRYABLE_ERROR_MARKERS = (
    "server disconnected without sending a response",
    "connection reset",
    "timed out",
    "timeout",
    "temporarily unavailable",
    "503",
    "504",
    "quota exceeded",
    "resource exhausted",
)


def get_vertex_ai_project() -> str:
    """获取 GCP 项目 ID"""
    project = os.getenv("VERTEX_AI_PROJECT") or os.getenv("GCP_PROJECT")
    if not project:
        raise RuntimeError(
            "Missing Vertex AI project. Set VERTEX_AI_PROJECT or GCP_PROJECT in your environment or .env file."
        )
    return project.strip()


def get_vertex_ai_location() -> str:
    """获取 Vertex AI 区域（默认 us-central1）"""
    return os.getenv("VERTEX_AI_LOCATION", "us-central1").strip()


def normalize_vertex_model_name(model: str) -> str:
    """
    标准化 Vertex AI 模型名称
    支持简写和完整路径
    """
    model = str(model or "").strip()
    if not model:
        return model

    # 如果已经是完整路径，直接返回
    if model.startswith("publishers/google/models/"):
        return model

    # 移除可能的前缀
    if model.startswith("google/"):
        model = model[7:]

    # 常见模型映射
    model_map = {
        "gemini-3-pro": "gemini-3-pro-preview",
        "gemini-3-pro-preview": "gemini-3-pro-preview",
        "gemini-2.5-pro": "gemini-2.5-pro",
        "gemini-2.0-flash": "gemini-2.0-flash-exp",
        "gemini-1.5-pro": "gemini-1.5-pro",
        "gemini-1.5-flash": "gemini-1.5-flash",
    }

    normalized = model_map.get(model.lower(), model)
    return normalized


class VertexAIClient:
    """Vertex AI 客户端封装"""

    def __init__(self, project: str, location: str):
        if not VERTEX_AI_AVAILABLE:
            raise RuntimeError(
                "vertexai package not installed. Install with: pip install google-cloud-aiplatform"
            )

        self.project = project
        self.location = location
        vertexai.init(project=project, location=location)
        print(f"[vertex_ai] 已初始化 Vertex AI: project={project}, location={location}", file=sys.stderr)

    def get_model(self, model_name: str) -> GenerativeModel:
        """获取生成模型实例"""
        return GenerativeModel(model_name)


def create_vertex_ai_client() -> VertexAIClient:
    """创建 Vertex AI 客户端"""
    project = get_vertex_ai_project()
    location = get_vertex_ai_location()
    return VertexAIClient(project=project, location=location)


def _is_retryable_error(exc: Exception) -> bool:
    """判断是否为可重试的错误"""
    message = str(exc or "").lower()
    return any(marker in message for marker in RETRYABLE_ERROR_MARKERS)


def _convert_to_vertex_content(contents) -> list[Content]:
    """将统一格式转换为 Vertex AI Content 格式"""
    if isinstance(contents, str):
        return [Content(role="user", parts=[Part.from_text(contents)])]

    if isinstance(contents, dict):
        if "text" in contents:
            return [Content(role="user", parts=[Part.from_text(contents["text"])])]
        # 处理其他格式
        return [Content(role="user", parts=[Part.from_text(str(contents))])]

    if isinstance(contents, list):
        parts = []
        for item in contents:
            if isinstance(item, str):
                parts.append(Part.from_text(item))
            elif isinstance(item, dict):
                if "text" in item:
                    parts.append(Part.from_text(item["text"]))
                elif "inline_data" in item:
                    # 处理 base64 图片/视频
                    inline = item["inline_data"]
                    parts.append(Part.from_data(
                        data=inline.get("data", ""),
                        mime_type=inline.get("mime_type", "image/jpeg")
                    ))
                elif "file_path" in item or "local_path" in item:
                    # Vertex AI 不支持本地文件，需要先上传到 GCS
                    path = item.get("file_path") or item.get("local_path")
                    print(f"警告: Vertex AI 不支持直接使用本地文件 {path}，请先上传到 GCS", file=sys.stderr)
                else:
                    parts.append(Part.from_text(str(item)))
            else:
                parts.append(Part.from_text(str(item)))

        return [Content(role="user", parts=parts)]

    return [Content(role="user", parts=[Part.from_text(str(contents))])]


class ResponseWrapper:
    """统一响应格式"""

    def __init__(self, response):
        self._response = response

    @property
    def text(self) -> str:
        """获取响应文本"""
        try:
            return self._response.text
        except Exception as e:
            print(f"警告: 无法获取响应文本: {e}", file=sys.stderr)
            return ""

    @property
    def raw_response(self):
        """获取原始响应"""
        return self._response


def generate_content(
    client: VertexAIClient,
    *,
    model: str,
    contents,
    response_mime_type: str | None = None,
    retries: int = DEFAULT_GENERATE_RETRIES,
    request_timeout: int | None = None,
) -> ResponseWrapper:
    """
    使用 Vertex AI 生成内容

    Args:
        client: VertexAIClient 实例
        model: 模型名称（如 gemini-3-pro-preview, google/gemini-3-pro-preview）
        contents: 输入内容
        response_mime_type: 响应 MIME 类型（如 application/json）
        retries: 重试次数
        request_timeout: 请求超时（Vertex AI SDK 不直接支持，仅用于兼容）
    """
    # 标准化模型名称
    normalized_model = normalize_vertex_model_name(model)

    vertex_contents = _convert_to_vertex_content(contents)
    model_instance = client.get_model(normalized_model)

    # 配置生成参数
    generation_config = {}
    if response_mime_type:
        generation_config["response_mime_type"] = response_mime_type

    attempts = max(1, int(retries or 1))
    last_error = None

    for attempt in range(1, attempts + 1):
        try:
            if generation_config:
                response = model_instance.generate_content(
                    vertex_contents,
                    generation_config=generation_config
                )
            else:
                response = model_instance.generate_content(vertex_contents)

            return ResponseWrapper(response)

        except Exception as exc:
            last_error = exc
            should_retry = attempt < attempts and _is_retryable_error(exc)

            if not should_retry:
                raise

            wait_seconds = min(8, attempt * 2)
            print(
                f"[vertex_ai] generate_content attempt {attempt}/{attempts} failed, retrying in {wait_seconds}s: {exc}",
                file=sys.stderr,
                flush=True,
            )
            time.sleep(wait_seconds)

    if last_error:
        raise last_error


# Vertex AI 不需要文件上传/删除（使用 GCS）
def upload_file(client: VertexAIClient, file_path: str, retries: int = 3):
    """Vertex AI 不支持文件上传，需要使用 GCS"""
    print("警告: Vertex AI 需要通过 GCS 处理文件，请先上传到 Cloud Storage", file=sys.stderr)
    return None


def wait_for_file_ready(client: VertexAIClient, file_ref, **kwargs):
    """Vertex AI 不需要等待文件处理"""
    return file_ref


def delete_file(client: VertexAIClient, file_name: str) -> None:
    """Vertex AI 不需要删除文件"""
    pass
