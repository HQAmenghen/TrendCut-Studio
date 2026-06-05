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
    def test_material_score_worker_runs_legacy_script_in_job_workspace(self):
        job = {
            "id": "job-score-1",
            "task_id": "task-score-1",
            "job_type": "material_score_worker",
            "payload": {
                "material_segments": {
                    "segments": [{"id": "seg-1", "text": "demo"}]
                }
            },
        }

        def fake_run(_script, _args, cwd, _timeout):
            Path(cwd, "material_segments_scored.json").write_text(
                json.dumps({"segments": [{"id": "seg-1", "total_score": 88}]}, ensure_ascii=False),
                encoding="utf-8",
            )
            return {"protocol_events": [{"type": "result", "message": "ok"}]}

        with tempfile.TemporaryDirectory() as temp_dir, patch("trendcut_worker.executor._run_python", side_effect=fake_run) as run_mock:
            result = execute_job(job, Path(temp_dir))

        self.assertEqual(result["result"]["executor"], "trendcut_worker.legacy.material_score_worker")
        self.assertEqual(result["result"]["structured_output"]["scored_segments"]["segments"][0]["total_score"], 88)
        run_mock.assert_called_once()
        self.assertTrue(run_mock.call_args.args[2].name.endswith("material_score_worker-workspace"))

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

    def test_clip_plan_worker_runs_legacy_clip_selector_skill(self):
        with tempfile.TemporaryDirectory() as temp_dir, patch("pipeline.skills.clip_selector.ClipSelectorSkill.run") as run_mock:
            from pipeline.skills.base import SkillResult

            run_mock.return_value = SkillResult(
                skill="clip_selector",
                output={"clips": [{"segment_id": "seg-1"}]},
                meta={"status": "ready"},
            )
            result = execute_job({
                "id": "job-clip-1",
                "task_id": "task-clip-1",
                "job_type": "clip_plan_worker",
                "payload": {"segments": [{"id": "seg-1"}]},
            }, Path(temp_dir))

        self.assertEqual(result["result"]["executor"], "trendcut_worker.legacy.clip_plan_worker")
        self.assertEqual(result["result"]["structured_output"]["clip_plan"]["clips"][0]["segment_id"], "seg-1")

    def test_material_driven_worker_runs_pipeline_cli(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            material_path = Path(temp_dir) / "material.mp4"
            material_path.write_bytes(b"fake")

            def fake_run(_script, args, _cwd, _timeout):
                output_dir = Path(args[args.index("--output-dir") + 1])
                Path(output_dir, "output_final.mp4").write_bytes(b"video")
                return {"protocol_events": [{"type": "result", "message": "ok"}]}

            with patch("trendcut_worker.executor._run_python", side_effect=fake_run):
                result = execute_job({
                    "id": "job-material-1",
                    "task_id": "task-material-1",
                    "job_type": "material_driven_worker",
                    "payload": {
                        "material_path": str(material_path),
                        "source_post": {"title": "demo"},
                        "allow_rule_fallback": True,
                    },
                }, Path(temp_dir))

        self.assertEqual(result["result"]["executor"], "trendcut_worker.legacy.material_driven_worker")
        self.assertTrue(result["result"]["structured_output"]["exists"])

    def test_xai_worker_runs_top10_cli_and_reads_result(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            def fake_run(_script, args, _cwd, _timeout):
                result_path = Path(args[args.index("--result") + 1])
                result_path.write_text(json.dumps({"items": [{"rank": 1}]}), encoding="utf-8")
                return {"protocol_events": [{"type": "result", "message": "ok"}]}

            with patch("trendcut_worker.executor._run_python", side_effect=fake_run):
                result = execute_job({
                    "id": "job-xai-1",
                    "task_id": "task-xai-1",
                    "job_type": "xai_worker",
                    "payload": {"partitionId": "crypto"},
                }, Path(temp_dir))

        self.assertEqual(result["result"]["executor"], "trendcut_worker.legacy.xai_worker")
        self.assertEqual(result["result"]["structured_output"]["result"]["items"][0]["rank"], 1)

    def test_review_worker_runs_legacy_review_script_and_reads_output(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            video_path = Path(temp_dir) / "video.mp4"
            video_path.write_bytes(b"fake")

            def fake_run(_script, args, _cwd, _timeout):
                output_path = Path(args[args.index("--output") + 1])
                output_path.write_text(json.dumps({"passed": True, "overall_score": 91}), encoding="utf-8")
                return {"protocol_events": [{"type": "result", "message": "ok"}]}

            with patch("trendcut_worker.executor._run_python", side_effect=fake_run):
                result = execute_job({
                    "id": "job-review-1",
                    "task_id": "task-review-1",
                    "job_type": "review_worker",
                    "payload": {"video_path": str(video_path), "metadata": {"title": "demo"}},
                }, Path(temp_dir))

        self.assertEqual(result["result"]["executor"], "trendcut_worker.legacy.review_worker")
        self.assertTrue(result["result"]["structured_output"]["review"]["passed"])

    def test_high_risk_workers_still_require_confirmation(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaises(PermissionError):
                execute_job({
                    "id": "job-publish-1",
                    "task_id": "task-publish-1",
                    "job_type": "publish_worker",
                    "payload": {},
                }, Path(temp_dir))


if __name__ == "__main__":
    unittest.main()
