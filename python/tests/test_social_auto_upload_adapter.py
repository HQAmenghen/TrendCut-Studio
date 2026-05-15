import sys
import unittest
from pathlib import Path


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


if __name__ == "__main__":
    unittest.main()
