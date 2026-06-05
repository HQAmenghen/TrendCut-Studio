import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "apps" / "worker" / "src"))
sys.path.insert(0, str(PROJECT_ROOT / "python"))

from trendcut_worker.executor import execute_job  # noqa: E402


class WorkerExecutorTests(unittest.TestCase):
    def test_script_worker_runs_legacy_script_rewriter_skill(self):
        response_payload = {
            "script_units": [
                {
                    "unit_id": 1,
                    "role": "hook",
                    "text": "比特币消息正在影响全球市场预期",
                    "content_intent": {},
                    "evidence": {},
                }
            ]
        }

        class FakeResponse:
            text = json.dumps(response_payload, ensure_ascii=False)

        job = {
            "id": "job-script-1",
            "task_id": "task-script-1",
            "job_type": "script_worker",
            "payload": {
                "source_post": {
                    "title": "Bitcoin market update",
                    "body": "Bitcoin market expectations changed after a policy signal.",
                }
            },
        }

        with tempfile.TemporaryDirectory() as temp_dir, \
             patch("pipeline.skills.script_rewriter_skill.create_llm_client", return_value=object()), \
             patch("pipeline.skills.script_rewriter_skill.generate_content", return_value=FakeResponse()), \
             patch("pipeline.skills.script_rewriter_skill.ScriptRewriterSkill._fetch_freshness_context", return_value={}):
            result = execute_job(job, Path(temp_dir))
            self.assertTrue(Path(result["artifacts"][0]["path"]).exists())

        worker_result = result["result"]
        self.assertEqual(worker_result["executor"], "trendcut_worker.legacy.script_worker")
        self.assertEqual(worker_result["legacy_entrypoint"], "python/pipeline/skills/script_rewriter_skill.py")
        self.assertIn("script_units", worker_result["structured_output"]["script"])
        self.assertEqual(result["artifacts"][0]["type"], "worker_manifest")


if __name__ == "__main__":
    unittest.main()
