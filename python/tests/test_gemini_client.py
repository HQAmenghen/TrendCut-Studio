import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
for candidate in (PROJECT_ROOT, PYTHON_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from gemini_client import create_gemini_client, generate_content  # noqa: E402
import vertex_ai_client  # noqa: E402


class FlakyModels:
    def __init__(self, fail_count: int):
        self.fail_count = fail_count
        self.calls = 0

    def generate_content(self, *, model, contents, config=None):
        self.calls += 1
        if self.calls <= self.fail_count:
            raise RuntimeError("Server disconnected without sending a response.")
        return {"model": model, "contents": contents, "config": config}


class FakeClient:
    def __init__(self, fail_count: int):
        self.models = FlakyModels(fail_count)


class GeminiClientRetryTest(unittest.TestCase):
    def test_minimum_five_attempts_applies_even_when_caller_requests_two(self):
        client = FakeClient(fail_count=4)

        with patch("gemini_client.time.sleep"):
            response = generate_content(
                client,
                model="gemini-3.1-pro-preview",
                contents="生成口播稿",
                response_mime_type="application/json",
                retries=2,
            )

        self.assertEqual(response["model"], "gemini-3.1-pro-preview")
        self.assertEqual(client.models.calls, 5)

    def test_remote_end_closed_disconnect_is_retryable(self):
        client = FakeClient(fail_count=0)

        def flaky_generate_content(*, model, contents, config=None):
            client.models.calls += 1
            if client.models.calls < 5:
                raise RuntimeError("Remote end closed connection without response")
            return {"model": model, "contents": contents, "config": config}

        client.models.generate_content = flaky_generate_content

        with patch("gemini_client.time.sleep"):
            response = generate_content(
                client,
                model="gemini-3.1-pro-preview",
                contents="生成口播稿",
                retries=2,
            )

        self.assertEqual(response["model"], "gemini-3.1-pro-preview")
        self.assertEqual(client.models.calls, 5)

    def test_min_retry_env_allows_vertex_disconnect_recovery_after_caller_limit(self):
        client = FakeClient(fail_count=2)

        with patch.dict(os.environ, {"GEMINI_GENERATE_MIN_RETRIES": "4"}, clear=False), patch(
            "gemini_client.time.sleep"
        ):
            response = generate_content(
                client,
                model="gemini-3.1-pro-preview",
                contents="生成口播稿",
                response_mime_type="application/json",
                retries=2,
            )

        self.assertEqual(response["model"], "gemini-3.1-pro-preview")
        self.assertEqual(client.models.calls, 3)


class FakeVertexModel:
    def __init__(self):
        self.calls = 0

    def generate_content(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls < 5:
            raise RuntimeError("Remote end closed connection without response")
        return type("VertexResponse", (), {"text": "ok"})()


class FakeVertexClient:
    def __init__(self, model):
        self.model = model

    def get_model(self, _model_name):
        return self.model


class VertexClientRetryTest(unittest.TestCase):
    def test_min_retry_applies_even_when_caller_requests_two(self):
        model = FakeVertexModel()

        with patch("vertex_ai_client.time.sleep"):
            response = vertex_ai_client.generate_content(
                FakeVertexClient(model),
                model="gemini-2.5-pro",
                contents="生成口播稿",
                retries=2,
            )

        self.assertEqual(response.text, "ok")
        self.assertEqual(model.calls, 5)


class GeminiClientVertexAuthTest(unittest.TestCase):
    def test_vertex_api_key_client_uses_developer_backend_without_project_or_location(self):
        created_clients = []

        def fake_client(**kwargs):
            created_clients.append(kwargs)
            return object()

        with patch.dict(
            os.environ,
            {
                "LLM_PROVIDER": "vertex",
                "VERTEX_AI_AUTH_MODE": "api_key",
                "VERTEX_AI_API_KEY": "vertex-key",
                "VERTEX_AI_PROJECT": "yumeato",
                "VERTEX_AI_LOCATION": "global",
            },
            clear=True,
        ), patch("gemini_client.genai.Client", side_effect=fake_client):
            create_gemini_client(vertex_mode=True)

        self.assertEqual(
            created_clients,
            [{"api_key": "vertex-key"}],
        )

    def test_vertex_api_key_mode_accepts_google_api_key_when_requested(self):
        created_clients = []

        def fake_client(**kwargs):
            created_clients.append(kwargs)
            return object()

        with patch.dict(
            os.environ,
            {
                "LLM_PROVIDER": "vertex",
                "VERTEX_AI_AUTH_MODE": "api_key",
                "GOOGLE_API_KEY": "google-vertex-key",
            },
            clear=True,
        ), patch("gemini_client.genai.Client", side_effect=fake_client):
            create_gemini_client(vertex_mode=True)

        self.assertEqual(
            created_clients,
            [{"api_key": "google-vertex-key"}],
        )


if __name__ == "__main__":
    unittest.main()
