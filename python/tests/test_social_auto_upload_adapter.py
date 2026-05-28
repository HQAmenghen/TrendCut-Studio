import sys
import tempfile
import unittest
from io import StringIO
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
PUBLISH_ROOT = PYTHON_ROOT / "publish"
for candidate in (PROJECT_ROOT, PYTHON_ROOT, PUBLISH_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

import social_auto_upload_adapter  # noqa: E402


class SocialAutoUploadAdapterTest(unittest.TestCase):
    def test_build_common_payload_normalizes_fields(self):
        payload = social_auto_upload_adapter.build_common_payload({
            "platform": "douyin",
            "platformLabel": "抖音",
            "publishMode": "draft",
            "accountName": "dy-main",
            "videoPath": "C:/tmp/video.mp4",
            "title": " 标题 ",
            "description": "简介",
            "tags": ["#AI", " 视频 "],
        })

        self.assertEqual(payload["platform"], "douyin")
        self.assertEqual(payload["publish_mode"], "draft")
        self.assertEqual(payload["account_name"], "dy-main")
        self.assertEqual(payload["tags"], ["AI", "视频"])

    def test_normalize_tags_accepts_comma_string(self):
        self.assertEqual(
            social_auto_upload_adapter.normalize_tags("#AI, 视频, ,#财经"),
            ["AI", "视频", "财经"],
        )

    def test_resolve_runtime_dir_sets_environment(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            runtime_dir = social_auto_upload_adapter.resolve_runtime_dir(tmp_dir)

            self.assertEqual(runtime_dir, Path(tmp_dir).resolve())
            self.assertEqual(
                Path(social_auto_upload_adapter.os.environ["SOCIAL_AUTO_UPLOAD_RUNTIME_DIR"]),
                runtime_dir,
            )

    def test_resolve_account_file_keeps_cookies_under_runtime(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            account_file = social_auto_upload_adapter.resolve_account_file(
                Path(tmp_dir),
                "douyin",
                "dy main/测试",
            )

            self.assertEqual(account_file.parent, Path(tmp_dir) / "cookies")
            self.assertEqual(account_file.name, "douyin_dymain测试.json")

    def test_normalize_qrcode_payload_falls_back_to_image_file(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            image_path = Path(tmp_dir) / "qr.png"
            image_path.write_bytes(b"qr")

            payload = social_auto_upload_adapter.normalize_qrcode_payload(
                {"image_path": str(image_path)},
                "抖音",
                "dy-main",
            )

            self.assertEqual(payload["qrCodeBase64"], "data:image/png;base64,cXI=")
            self.assertEqual(payload["qrCodePath"], str(image_path))
            self.assertEqual(payload["accountLabel"], "抖音")
            self.assertEqual(payload["accountId"], "dy-main")

    def test_ensure_cookie_ready_emits_qrcode_status_from_setup_callback(self):
        async def fake_setup(_account_file, handle, return_detail, qrcode_callback, headless):
            self.assertTrue(handle)
            self.assertTrue(return_detail)
            self.assertFalse(headless)
            qrcode_callback({
                "image_data_url": "data:image/png;base64,abc",
                "image_path": "C:/tmp/qr.png",
            })
            return {"success": True}

        modules = {
            "douyin_setup": fake_setup,
            "xiaohongshu_setup": fake_setup,
        }
        with tempfile.TemporaryDirectory() as tmp_dir, patch("sys.stdout", new_callable=StringIO) as stdout:
            account_file = social_auto_upload_adapter.asyncio.run(
                social_auto_upload_adapter.ensure_cookie_ready(modules, Path(tmp_dir), "douyin", "dy-main", False)
            )

            self.assertEqual(account_file, Path(tmp_dir) / "cookies" / "douyin_dy-main.json")
            output = stdout.getvalue()
            self.assertIn("STATUS|need_login|social-auto-upload|抖音需要扫码登录，请在控制台扫描二维码|", output)
            self.assertIn('"qrCodeBase64": "data:image/png;base64,abc"', output)
            self.assertIn('"qrCodePath": "C:/tmp/qr.png"', output)

    def test_active_context_pages_ignores_closed_pages(self):
        class FakePage:
            def __init__(self, closed):
                self.closed = closed

            def is_closed(self):
                return self.closed

        class FakeContext:
            pages = [FakePage(True), FakePage(False)]

        active = social_auto_upload_adapter.active_context_pages(FakeContext())

        self.assertEqual(len(active), 1)
        self.assertFalse(active[0].is_closed())


if __name__ == "__main__":
    unittest.main()
