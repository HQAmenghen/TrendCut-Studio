import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
for candidate in (PROJECT_ROOT, PYTHON_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from xai import run_xai_top10 as runner  # noqa: E402


class XaiTop10PromptTest(unittest.TestCase):
    def test_ai_partition_candidate_prompt_uses_ai_domain_guidance(self):
        prompt = runner.candidate_prompt(
            "sama",
            "2026-05-11T10:57:00+08:00",
            "2026-05-12T10:57:00+08:00",
            {
                "id": "ai",
                "label": "AI",
                "description": "AI 模型、应用和研究账号池",
            },
        )

        self.assertIn("AI model, application, and research video selection assistant", prompt)
        self.assertIn("AI models, agents, research breakthroughs", prompt)
        self.assertIn("model demos, agent/product launches", prompt)
        self.assertNotIn("You are a crypto video selection assistant", prompt)

    def test_finance_partition_candidate_prompt_uses_finance_domain_guidance(self):
        prompt = runner.candidate_prompt(
            "unusual_whales",
            "2026-05-11T10:57:00+08:00",
            "2026-05-12T10:57:00+08:00",
            {
                "id": "finance",
                "label": "金融",
                "description": "宏观、市场和金融账号池",
            },
        )

        self.assertIn("finance and macro markets video selection assistant", prompt)
        self.assertIn("macro economy, equities, bonds, central banks", prompt)
        self.assertIn("Exclude crypto-only posts", prompt)

    def test_custom_partition_candidate_prompt_uses_partition_label_and_description(self):
        prompt = runner.candidate_prompt(
            "medical_ai_lab",
            "2026-05-11T10:57:00+08:00",
            "2026-05-12T10:57:00+08:00",
            {
                "id": "medical-ai",
                "label": "医疗AI",
                "description": "医疗 AI 应用、研究和产业账号池",
            },
        )

        self.assertIn("You are a 医疗AI video selection assistant", prompt)
        self.assertIn("医疗 AI 应用、研究和产业账号池", prompt)
        self.assertIn("Exclude posts that do not clearly match the 医疗AI partition", prompt)


class XaiTop10FailureHandlingTest(unittest.TestCase):
    def test_candidate_scan_aborts_when_every_account_failed_without_candidates(self):
        failures = [
            {"account": "BitcoinMagazine", "message": "Permission denied from xAI API: monthly spending limit reached"},
            {"account": "CoinDesk", "message": "Permission denied from xAI API: monthly spending limit reached"},
        ]

        self.assertTrue(runner.should_abort_candidate_scan(2, [], failures))
        message = runner.format_candidate_scan_failure(failures)

        self.assertIn("All candidate scans failed", message)
        self.assertIn("@BitcoinMagazine", message)
        self.assertIn("monthly spending limit", message)

    def test_candidate_scan_does_not_abort_empty_result_without_failures(self):
        self.assertFalse(runner.should_abort_candidate_scan(2, [], []))

    def test_candidate_scan_does_not_abort_when_any_candidate_was_collected(self):
        failures = [{"account": "CoinDesk", "message": "temporary failure"}]

        self.assertFalse(runner.should_abort_candidate_scan(2, [{"post_id": "1"}], failures))


if __name__ == "__main__":
    unittest.main()
