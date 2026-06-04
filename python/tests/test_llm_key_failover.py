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

import deepseek_client  # noqa: E402
import qwen_client  # noqa: E402


class FakeQwenResponse:
    def __init__(self, status_code=200, code="", message="", text="ok"):
        self.status_code = status_code
        self.code = code
        self.message = message
        self.output = {"choices": [{"message": {"content": text}}]}


class QwenKeyFailoverTest(unittest.TestCase):
    def test_generate_content_uses_next_key_when_balance_error_response_returned(self):
        used_keys = []

        def fake_generation_call(**kwargs):
            used_keys.append(kwargs["api_key"])
            if kwargs["api_key"] == "qwen-key-1":
                return FakeQwenResponse(
                    status_code=402,
                    code="BalanceError",
                    message="insufficient balance",
                )
            return FakeQwenResponse(text="ok-from-second-key")

        with patch.dict(
            os.environ,
            {
                "QWEN_API_KEY": "qwen-key-1;qwen-key-2",
                "QWEN_KEY_FAILOVER_COOLDOWN_SECONDS": "60",
            },
            clear=False,
        ), patch("qwen_client.Generation.call", side_effect=fake_generation_call), patch(
            "qwen_client.time.sleep"
        ):
            client = qwen_client.create_qwen_client()
            response = qwen_client.generate_content(
                client,
                model="qwen-plus",
                contents="hello",
                retries=1,
            )

        self.assertEqual(response.text, "ok-from-second-key")
        self.assertEqual(used_keys, ["qwen-key-1", "qwen-key-2"])

    def test_generate_content_uses_minimum_eight_attempts_even_when_caller_requests_one(self):
        attempts = []

        def fake_generation_call(**kwargs):
            attempts.append(kwargs["api_key"])
            if len(attempts) < 8:
                raise RuntimeError("Remote end closed connection without response")
            return FakeQwenResponse(text="ok-after-retries")

        with patch.dict(
            os.environ,
            {
                "QWEN_API_KEY": "qwen-key-1",
            },
            clear=False,
        ), patch("qwen_client.Generation.call", side_effect=fake_generation_call), patch(
            "qwen_client.time.sleep"
        ):
            client = qwen_client.create_qwen_client()
            response = qwen_client.generate_content(
                client,
                model="qwen-plus",
                contents="hello",
                retries=1,
            )

        self.assertEqual(response.text, "ok-after-retries")
        self.assertEqual(len(attempts), 8)

    def test_generate_content_passes_json_response_format_for_qwen(self):
        captured_kwargs = []

        def fake_generation_call(**kwargs):
            captured_kwargs.append(kwargs)
            return FakeQwenResponse(text='{"ok": true}')

        with patch.dict(
            os.environ,
            {
                "QWEN_API_KEY": "qwen-key-1",
            },
            clear=False,
        ), patch("qwen_client.Generation.call", side_effect=fake_generation_call):
            client = qwen_client.create_qwen_client()
            response = qwen_client.generate_content(
                client,
                model="qwen-plus",
                contents="return json",
                response_mime_type="application/json",
                retries=1,
            )

        self.assertEqual(response.text, '{"ok": true}')
        self.assertEqual(captured_kwargs[0]["response_format"], {"type": "json_object"})

    def test_generate_content_keeps_qwen35_model_on_multimodal_api(self):
        captured_kwargs = []

        def fake_multimodal_call(**kwargs):
            captured_kwargs.append(kwargs)
            return FakeQwenResponse(text='{"ok": true}')

        with patch.dict(
            os.environ,
            {
                "QWEN_API_KEY": "qwen-key-1",
            },
            clear=False,
        ), patch("qwen_client.Generation.call") as generation_call, patch(
            "qwen_client.MultiModalConversation.call", side_effect=fake_multimodal_call
        ):
            client = qwen_client.create_qwen_client()
            response = qwen_client.generate_content(
                client,
                model="qwen3.5-plus",
                contents="return json",
                response_mime_type="application/json",
                retries=1,
            )

        self.assertEqual(response.text, '{"ok": true}')
        self.assertFalse(generation_call.called)
        self.assertEqual(captured_kwargs[0]["model"], "qwen3.5-plus")
        self.assertEqual(captured_kwargs[0]["response_format"], {"type": "json_object"})


class FakeDeepSeekMessage:
    content = "ok-from-second-key"


class FakeDeepSeekChoice:
    message = FakeDeepSeekMessage()


class FakeDeepSeekResponse:
    choices = [FakeDeepSeekChoice()]


class FakeDeepSeekCompletions:
    def __init__(self, api_key, used_keys):
        self.api_key = api_key
        self.used_keys = used_keys

    def create(self, **_kwargs):
        self.used_keys.append(self.api_key)
        if self.api_key == "deepseek-key-1":
            raise RuntimeError("insufficient balance")
        return FakeDeepSeekResponse()


class FakeDeepSeekChat:
    def __init__(self, api_key, used_keys):
        self.completions = FakeDeepSeekCompletions(api_key, used_keys)


class DeepSeekKeyFailoverTest(unittest.TestCase):
    def test_generate_content_uses_next_key_when_first_key_is_out_of_balance(self):
        used_keys = []

        class FakeOpenAI:
            def __init__(self, *, api_key, base_url):
                self.api_key = api_key
                self.base_url = base_url
                self.chat = FakeDeepSeekChat(api_key, used_keys)

        with patch.dict(
            os.environ,
            {
                "DEEPSEEK_API_KEY": "deepseek-key-1;deepseek-key-2",
                "DEEPSEEK_KEY_FAILOVER_COOLDOWN_SECONDS": "60",
            },
            clear=False,
        ), patch("deepseek_client.OpenAI", FakeOpenAI), patch("deepseek_client.time.sleep"):
            client = deepseek_client.create_deepseek_client()
            response = deepseek_client.generate_content(
                client,
                model="deepseek-chat",
                contents="hello",
                retries=1,
            )

        self.assertEqual(response.text, "ok-from-second-key")
        self.assertEqual(used_keys, ["deepseek-key-1", "deepseek-key-2"])

    def test_generate_content_uses_minimum_five_attempts_even_when_caller_requests_two(self):
        used_keys = []

        class FlakyCompletions:
            def __init__(self, api_key, used):
                self.api_key = api_key
                self.used = used

            def create(self, **_kwargs):
                self.used.append(self.api_key)
                if len(self.used) < 5:
                    raise RuntimeError("Remote end closed connection without response")
                return FakeDeepSeekResponse()

        class FlakyChat:
            def __init__(self, api_key, used):
                self.completions = FlakyCompletions(api_key, used)

        class FlakyOpenAI:
            def __init__(self, *, api_key, base_url):
                self.api_key = api_key
                self.base_url = base_url
                self.chat = FlakyChat(api_key, used_keys)

        with patch.dict(
            os.environ,
            {
                "DEEPSEEK_API_KEY": "deepseek-key-1",
            },
            clear=False,
        ), patch("deepseek_client.OpenAI", FlakyOpenAI), patch("deepseek_client.time.sleep"):
            client = deepseek_client.create_deepseek_client()
            response = deepseek_client.generate_content(
                client,
                model="deepseek-chat",
                contents="hello",
                retries=2,
            )

        self.assertEqual(response.text, "ok-from-second-key")
        self.assertEqual(len(used_keys), 5)


if __name__ == "__main__":
    unittest.main()
