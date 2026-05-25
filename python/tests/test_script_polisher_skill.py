import json
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

from pipeline.skills.script_polisher_skill import ScriptPolisherSkill, resolve_polish_char_bounds  # noqa: E402


def _response(payload):
    class FakeResponse:
        text = json.dumps(payload, ensure_ascii=False)

    return FakeResponse()


def _valid_blackrock_units():
    return {
        "script_units": [
            {
                "unit_id": 1,
                "role": "hook",
                "text": "BlackRock 的 Jay Jacobs 这次把比特币讲得很克制：它不是万能答案，却能给投资组合增加一块不太跟股票债券同频的资产。",
                "content_intent": {"claim_type": "speaker_quote_summary", "core_claim": "BlackRock Jay Jacobs 认为比特币能提供组合价值", "market_relevance": "high", "needs_visual_evidence": True},
                "evidence": {"source_priority": "source_post", "insert_priority": "high", "evidence_query": "BlackRock Jay Jacobs Bitcoin portfolio value", "evidence_types": ["video_transcript"], "must_match": {"persons": ["Jay Jacobs"], "orgs": ["BlackRock"], "assets": ["Bitcoin"], "event_types": [], "event_tags": ["portfolio value"], "polarity": "neutral"}},
            },
            {
                "unit_id": 2,
                "role": "explain",
                "text": "很多人只盯价格波动，但他的重点其实是相关性。把比特币放进组合里，更像给资产配置加一份数学保险，涨跌都要放在整体风险里看。",
                "content_intent": {"claim_type": "data_interpretation", "core_claim": "比特币的组合价值来自相关性和风险分散", "market_relevance": "high", "needs_visual_evidence": True},
                "evidence": {"source_priority": "video_transcript", "insert_priority": "medium", "evidence_query": "Bitcoin portfolio diversification own rules", "evidence_types": ["video_transcript"], "must_match": {"persons": [], "orgs": [], "assets": ["Bitcoin"], "event_types": [], "event_tags": ["diversification"], "polarity": "neutral"}},
            },
            {
                "unit_id": 3,
                "role": "ending",
                "text": "真正的变化在于，传统机构的讨论焦点已经从要不要碰加密资产，转向它在组合里该承担什么角色。短期价格会吵，长期框架才更关键，仓位可以小，但认知不能缺席。真正要看的，是它能不能长期降低组合波动，并在压力期提供缓冲。",
                "content_intent": {"claim_type": "market_judgment", "core_claim": "机构讨论焦点转向比特币在组合中的长期角色", "market_relevance": "high", "needs_visual_evidence": True},
                "evidence": {"source_priority": "video_transcript", "insert_priority": "medium", "evidence_query": "Bitcoin role in broader portfolio", "evidence_types": ["video_transcript"], "must_match": {"persons": [], "orgs": ["BlackRock"], "assets": ["Bitcoin"], "event_types": [], "event_tags": ["long term portfolio"], "polarity": "neutral"}},
            },
        ]
    }


class ScriptPolisherSkillTest(unittest.TestCase):
    def setUp(self):
        self.payload = {
            "draft_script_units": [
                {"unit_id": 1, "role": "hook", "text": "BlackRock 的 Jay Jacobs 说，比特币提供投资组合价值。"},
                {"unit_id": 2, "role": "explain", "text": "比特币由自身规则驱动，可以作为分散风险资产。"},
                {"unit_id": 3, "role": "ending", "text": "短期价格不是唯一重点。"},
            ],
            "source_post": {
                "title": "BlackRock 的 Jay Jacobs 向 Fox Business 表示，比特币提供投资组合价值，受自身规则驱动",
                "body": "BlackRock's Jay Jacobs tells Fox Business Bitcoin provides portfolio value, driven by its own rules",
            },
            "outline": {"target_duration_sec": 45, "segments": [{"summary": "比特币给投资组合提供价值，并由自身规则驱动。"}]},
            "audio": [{"start": 0, "end": 3, "text": "比特币提供价值给人们的投资组合。"}],
            "selected_segments": {"segments": [{"id": "seg_1", "text": "比特币提供投资组合价值。"}]},
        }

    def test_default_polish_char_bounds_target_one_minute_limit(self):
        with patch.dict(os.environ, {
            "SCRIPT_POLISH_MIN_CHARS": "",
            "SCRIPT_POLISH_MAX_CHARS": "",
        }, clear=False):
            min_chars, max_chars = resolve_polish_char_bounds()

        self.assertEqual(min_chars, 220)
        self.assertEqual(max_chars, 300)

    def test_accepts_valid_polished_units(self):
        skill = ScriptPolisherSkill()

        with patch("pipeline.skills.script_polisher_skill.create_llm_client", return_value=object()), patch(
            "pipeline.skills.script_polisher_skill.get_llm_provider",
            return_value="qwen",
        ), patch(
            "pipeline.skills.script_polisher_skill.generate_content",
            return_value=_response(_valid_blackrock_units()),
        ):
            result = skill.run(self.payload)

        self.assertEqual(result.meta["status"], "ready")
        self.assertEqual(result.meta["decision_mode"], "llm_polish")
        self.assertFalse(result.meta["repair_applied"])
        self.assertGreaterEqual(result.meta["char_count"], 220)
        self.assertLessEqual(result.meta["char_count"], 300)
        self.assertEqual(len(result.output["script_units"]), 3)
        self.assertIn("BlackRock", result.output["script_units"][0]["text"])

    def test_partition_prompt_addendum_is_included_in_polish_prompt(self):
        skill = ScriptPolisherSkill()
        payload = {
            **self.payload,
            "source_post": {
                **self.payload["source_post"],
                "sourcePartitionId": "finance",
                "sourcePartitionLabel": "金融",
            },
        }

        with patch("pipeline.skills.script_polisher_skill.create_llm_client", return_value=object()), patch(
            "pipeline.skills.script_polisher_skill.get_llm_provider",
            return_value="qwen",
        ), patch(
            "pipeline.skills.script_polisher_skill.generate_content",
            return_value=_response(_valid_blackrock_units()),
        ) as generate:
            result = skill.run(payload)

        self.assertEqual(result.meta["status"], "ready")
        prompt = generate.call_args_list[0].kwargs["contents"]
        self.assertIn("当前分区是「金融」", prompt)
        self.assertEqual(result.meta["partition_prompt_profile"]["profile_key"], "finance")

    def test_retries_once_when_first_output_is_off_topic(self):
        skill = ScriptPolisherSkill()
        off_topic = {
            "script_units": [
                {"unit_id": 1, "role": "hook", "text": "这家初创公司融资速度很快，资本继续押注人工智能基础设施。"},
                {"unit_id": 2, "role": "explain", "text": "技术落地和融资节奏正在改变创业公司的估值方式。"},
                {"unit_id": 3, "role": "ending", "text": "所以要关注一级市场的资金流向。"},
            ]
        }

        with patch("pipeline.skills.script_polisher_skill.create_llm_client", return_value=object()), patch(
            "pipeline.skills.script_polisher_skill.get_llm_provider",
            return_value="qwen",
        ), patch(
            "pipeline.skills.script_polisher_skill.generate_content",
            side_effect=[_response(off_topic), _response(_valid_blackrock_units())],
        ) as generate:
            result = skill.run(self.payload)

        self.assertEqual(generate.call_count, 2)
        self.assertEqual(result.meta["status"], "ready")
        self.assertTrue(result.meta["repair_applied"])
        self.assertNotIn("初创公司", "".join(item["text"] for item in result.output["script_units"]))

    def test_retries_when_output_contains_monitor_account_and_parenthetical_gloss(self):
        skill = ScriptPolisherSkill()
        payload = {
            **self.payload,
            "source_post": {
                "body": "@BMNRBullz - Tom Lee warns about a 15-20% summer drawdown before the biggest rally of our lifetime.",
                "author": "BMNRBullz",
                "postUrl": "https://x.com/BMNRBullz/status/2056061081995378881",
            },
            "draft_script_units": [
                {"unit_id": 1, "role": "hook", "text": "Tom Lee 提到夏季可能先回调15-20%。"},
                {"unit_id": 2, "role": "explain", "text": "之后才可能迎来更大的反弹。"},
                {"unit_id": 3, "role": "ending", "text": "关键是分清短期压力和长期判断。"},
            ],
        }
        invalid = {
            "script_units": [
                {"unit_id": 1, "role": "hook", "text": "BMNRBullz账号分享Tom Lee判断：夏季可能先回调15-20%。"},
                {"unit_id": 2, "role": "explain", "text": "他称这是更大反弹（THE BIGGEST RALLY）之前的痛苦。"},
                {"unit_id": 3, "role": "ending", "text": "所以短期波动更像一场压力测试。"},
            ]
        }
        repaired = {
            "script_units": [
                {"unit_id": 1, "role": "hook", "text": "Tom Lee 这次的判断很直接：夏季可能先出现15-20%的回调，市场要先承受一段压力。"},
                {"unit_id": 2, "role": "explain", "text": "他的重点放在回调之后的更大反弹窗口，节奏上先压低预期，再观察资金重新进场。"},
                {"unit_id": 3, "role": "ending", "text": "真正要看的，是这轮压力测试会不会改变中长期方向。短期波动可以很难受，但判断不能只盯一两天的涨跌。"},
            ]
        }

        with patch("pipeline.skills.script_polisher_skill.create_llm_client", return_value=object()), patch(
            "pipeline.skills.script_polisher_skill.get_llm_provider",
            return_value="qwen",
        ), patch(
            "pipeline.skills.script_polisher_skill.generate_content",
            side_effect=[_response(invalid), _response(repaired)],
        ) as generate:
            with patch.dict(os.environ, {
                "SCRIPT_POLISH_MIN_CHARS": "80",
                "SCRIPT_POLISH_MAX_CHARS": "260",
            }, clear=False):
                result = skill.run(payload)

        self.assertEqual(generate.call_count, 2)
        self.assertEqual(result.meta["status"], "ready")
        self.assertTrue(result.meta["repair_applied"])
        full_text = "".join(item["text"] for item in result.output["script_units"])
        self.assertNotIn("BMNRBullz", full_text)
        self.assertNotIn("（THE BIGGEST RALLY）", full_text)
        self.assertIn("Tom Lee", full_text)

    def test_retries_when_first_output_exceeds_max_chars(self):
        skill = ScriptPolisherSkill()
        over_limit = _valid_blackrock_units()
        over_limit["script_units"][2]["text"] += (
            "这段补充说明故意写得很长，用来模拟模型没有遵守最长字数限制的情况。"
            "系统必须拒绝这版口播稿，继续请求大模型压缩，而不是把超长文案放行给数字人。"
        ) * 3

        with patch.dict(os.environ, {
            "SCRIPT_POLISH_MIN_CHARS": "220",
            "SCRIPT_POLISH_MAX_CHARS": "300",
        }, clear=False), patch(
            "pipeline.skills.script_polisher_skill.create_llm_client",
            return_value=object(),
        ), patch(
            "pipeline.skills.script_polisher_skill.get_llm_provider",
            return_value="qwen",
        ), patch(
            "pipeline.skills.script_polisher_skill.generate_content",
            side_effect=[_response(over_limit), _response(_valid_blackrock_units())],
        ) as generate:
            result = skill.run(self.payload)

        self.assertEqual(generate.call_count, 2)
        self.assertEqual(result.meta["status"], "ready")
        self.assertTrue(result.meta["repair_applied"])
        self.assertLessEqual(result.meta["char_count"], 300)

    def test_over_limit_draft_retries_even_when_polish_is_disabled(self):
        skill = ScriptPolisherSkill()
        long_text = "BlackRock 的 Jay Jacobs 说，比特币提供投资组合价值。" * 20
        payload = {
            **self.payload,
            "draft_script_units": [
                {"unit_id": 1, "role": "hook", "text": long_text},
                {"unit_id": 2, "role": "explain", "text": "比特币由自身规则驱动。"},
                {"unit_id": 3, "role": "ending", "text": "短期价格不是唯一重点。"},
            ],
        }

        with patch.dict(os.environ, {
            "SCRIPT_POLISH_ENABLED": "0",
            "SCRIPT_POLISH_MAX_CHARS": "300",
        }, clear=False), patch(
            "pipeline.skills.script_polisher_skill.create_llm_client",
            return_value=object(),
        ), patch(
            "pipeline.skills.script_polisher_skill.get_llm_provider",
            return_value="qwen",
        ), patch(
            "pipeline.skills.script_polisher_skill.generate_content",
            return_value=_response(_valid_blackrock_units()),
        ) as generate:
            result = skill.run(payload)

        self.assertEqual(generate.call_count, 1)
        self.assertEqual(result.meta["status"], "ready")
        self.assertTrue(result.meta["llm_used"])
        self.assertLessEqual(result.meta["char_count"], 300)

    def test_fails_when_repair_output_is_still_invalid(self):
        skill = ScriptPolisherSkill()
        invalid = {
            "script_units": [
                {"unit_id": 1, "role": "hook", "text": "初创公司融资又有新变化。"},
                {"unit_id": 2, "role": "explain", "text": "资本继续押注人工智能。"},
                {"unit_id": 3, "role": "ending", "text": "这值得持续观察。"},
            ]
        }

        with patch("pipeline.skills.script_polisher_skill.create_llm_client", return_value=object()), patch(
            "pipeline.skills.script_polisher_skill.get_llm_provider",
            return_value="qwen",
        ), patch(
            "pipeline.skills.script_polisher_skill.generate_content",
            side_effect=[_response(invalid), _response(invalid)],
        ):
            result = skill.run(self.payload)

        self.assertEqual(result.meta["status"], "failed")
        self.assertEqual(result.output["script_units"], [])
        self.assertIn("validation_errors", result.meta)


if __name__ == "__main__":
    unittest.main()
