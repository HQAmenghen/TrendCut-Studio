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

from pipeline.skills.partition_prompt_profile import format_partition_addendum, resolve_partition_prompt_profile  # noqa: E402
from pipeline.skills.script_rewriter_skill import ScriptRewriterSkill  # noqa: E402


class ScriptRewriterStyleGuardTest(unittest.TestCase):
    def setUp(self):
        self.skill = ScriptRewriterSkill()

    def test_detect_ai_transition_templates_flags_banned_contrast_patterns(self):
        script_units = [
            {
                "id": "script_001",
                "role": "hook",
                "text": "美国众议员 Thomas Massie 突然抛出一枚重磅炸弹。他计划提交法案，目标直指终结美联储。这可不是市场传闻，而是正式的法律动作",
            },
            {
                "id": "script_002",
                "role": "explain",
                "text": "显然，加密资产的理念正在渗透进立法层。不再仅仅是价格波动，而是试图动摇传统金融的根基。这种碰撞，以往很少见到",
            },
        ]

        violations = self.skill._detect_ai_transition_templates(script_units)

        self.assertEqual(
            violations,
            [
                "这可不是市场传闻，而是正式的法律动作",
                "不再仅仅是价格波动，而是试图动摇传统金融的根基",
            ],
        )

    def test_sanitize_unit_text_strips_collapsed_transition_shells(self):
        cleaned = self.skill._sanitize_unit_text("这可不是，而是。不再，而是。")

        self.assertEqual(cleaned, "")

    def test_build_repair_prompt_includes_style_violations(self):
        prompt = self.skill._build_repair_prompt(
            base_prompt="base",
            source_focus={"has_source_anchor": True, "numeric_cues": []},
            coverage={"missing_cues": []},
            current_units=[{"text": "这可不是市场传闻，而是正式的法律动作"}],
            style_violations=["这可不是市场传闻，而是正式的法律动作"],
        )

        self.assertIn("AI 模板化强转折句式", prompt)
        self.assertIn("这可不是市场传闻，而是正式的法律动作", prompt)

    def test_partition_prompt_profile_uses_known_ids_only(self):
        profile = resolve_partition_prompt_profile({
            "sourcePartitionId": "finance",
            "sourcePartitionLabel": "金融",
        })

        self.assertEqual(profile["profile_key"], "finance")
        self.assertIn("当前分区是「金融」", format_partition_addendum(profile))

        custom_profile = resolve_partition_prompt_profile({
            "sourcePartitionId": "health-ai",
            "sourcePartitionLabel": "医疗AI",
        })

        self.assertEqual(custom_profile["profile_key"], "custom")
        self.assertIn("当前分区是「医疗AI」", format_partition_addendum(custom_profile))

    def test_is_script_context_compatible_rejects_reused_off_topic_script(self):
        source_post = {
            "title": "全息卡打造未来主义加密支付体验。",
            "body": "全息卡打造未来主义加密支付体验。\nFuturistic crypto payments with holographic card",
        }
        outline = {
            "segments": [
                {
                    "summary": "Card displays 'SWIPE UP' prompt and 'PRT Print Revenue Token' balance with purple glow; phone screen shows 'LaFerrari $3,000,000'。",
                    "goal": "Card displays 'SWIPE UP' prompt and 'PRT Print Revenue Token' balance with purple glow; phone screen shows 'LaFerrari $3,000,000'。",
                },
                {
                    "summary": "Card displays final BTC balance and transaction summary with green glow; 'PRINT WORLD' logo remains visible throughout。",
                    "goal": "Card displays final BTC balance and transaction summary with green glow; 'PRINT WORLD' logo remains visible throughout。",
                },
            ]
        }
        selected_segments = [
            {
                "text": "Card displays final BTC balance and transaction summary with green glow; PRINT WORLD logo remains visible throughout",
                "visual_summary": "Card displays final BTC balance and transaction summary with green glow; PRINT WORLD logo remains visible throughout",
                "reason": "展示加密支付卡最终交易完成状态",
            }
        ]
        off_topic_units = [
            {
                "id": "script_001",
                "role": "hook",
                "text": "你能想象吗？这家初创公司单笔融资，直接干到了十亿美元",
            },
            {
                "id": "script_002",
                "role": "explain",
                "text": "消息显示，头部机构领投，资金全砸进了新一代模型训练",
            },
        ]

        self.assertFalse(
            self.skill.is_script_context_compatible(
                script_units=off_topic_units,
                source_post=source_post,
                outline=outline,
                selected_segments=selected_segments,
            )
        )

    def test_is_script_context_compatible_accepts_source_aligned_showcase_script(self):
        source_post = {
            "title": "全息卡打造未来主义加密支付体验。",
            "body": "全息卡打造未来主义加密支付体验。\nFuturistic crypto payments with holographic card",
        }
        outline = {
            "segments": [
                {
                    "summary": "Card displays 'SWIPE UP' prompt and 'PRT Print Revenue Token' balance with purple glow; phone screen shows 'LaFerrari $3,000,000'。",
                    "goal": "Card displays 'SWIPE UP' prompt and 'PRT Print Revenue Token' balance with purple glow; phone screen shows 'LaFerrari $3,000,000'。",
                }
            ]
        }
        selected_segments = [
            {
                "text": "Card displays final BTC balance and transaction summary with green glow; PRINT WORLD logo remains visible throughout",
                "visual_summary": "Card displays final BTC balance and transaction summary with green glow; PRINT WORLD logo remains visible throughout",
                "reason": "展示加密支付卡最终交易完成状态",
            }
        ]
        aligned_units = [
            {
                "id": "script_001",
                "role": "hook",
                "text": "这条视频展示的是一张带全息界面的全息卡，主打未来主义加密支付体验。",
            },
            {
                "id": "script_002",
                "role": "explain",
                "text": "画面里能看到 PRT、SOL、BTC 等资产切换，也能看到这张 holographic card 在模拟 crypto payments 的完整交互。",
            },
        ]

        self.assertTrue(
            self.skill.is_script_context_compatible(
                script_units=aligned_units,
                source_post=source_post,
                outline=outline,
                selected_segments=selected_segments,
            )
        )

    def test_is_script_context_compatible_accepts_pure_chinese_showcase_script(self):
        source_post = {
            "title": "全息卡打造未来主义加密支付体验。",
            "body": "全息卡打造未来主义加密支付体验。\nFuturistic crypto payments with holographic card",
        }
        outline = {
            "segments": [
                {
                    "summary": "Card displays PRT, SOL, BTC balances and purchase flow for a LaFerrari with futuristic lighting。",
                    "goal": "Card demo shows crypto balances switching and the final transaction summary。",
                }
            ]
        }
        selected_segments = [
            {
                "text": "Card displays final BTC balance and transaction summary with green glow; PRINT WORLD logo remains visible throughout",
                "visual_summary": "Card displays final BTC balance and transaction summary with green glow; PRINT WORLD logo remains visible throughout",
                "reason": "展示加密支付卡最终交易完成状态",
            }
        ]
        aligned_units = [
            {
                "id": "script_001",
                "role": "hook",
                "text": "全息卡正在打造未来主义加密支付体验，现实比想象更超前。",
            },
            {
                "id": "script_002",
                "role": "explain",
                "text": "这张半透明卡片能实时切换比特币与索拉纳余额，甚至直接刷卡买下三百万的法拉利。",
            },
            {
                "id": "script_003",
                "role": "close",
                "text": "从虚拟资产到现实消费，未来钱包的模样，此刻已经清晰可见。",
            },
        ]

        self.assertTrue(
            self.skill.is_script_context_compatible(
                script_units=aligned_units,
                source_post=source_post,
                outline=outline,
                selected_segments=selected_segments,
            )
        )

    def test_is_script_context_compatible_accepts_chinese_market_rewrite_with_english_source(self):
        source_post = {
            "title": "Tom Lee 称未来 18-24 个月可能是人生最佳时期：散户追逐涨势，美股估值倍数扩张，盈利与倍数增长。",
            "body": "Tom Lee says the next 18-24 months could be the best of our lives: retail chasing rally, US multiples expanding, earnings and multiple growth.",
        }
        aligned_units = [
            {
                "id": "script_001",
                "role": "hook",
                "text": "你能想象吗？Tom Lee 直接断言，未来 18-24 个月，可能是我们人生中最好的市场时期",
            },
            {
                "id": "script_002",
                "role": "explain",
                "text": "支撑这一判断的理由很明确，散户正在追逐涨势，美股估值倍数也在同步扩张",
            },
            {
                "id": "script_003",
                "role": "explain",
                "text": "盈利与倍数同步增长，两股力量叠加，推动市场情绪发生明显变化",
            },
        ]

        self.assertTrue(
            self.skill.is_script_context_compatible(
                script_units=aligned_units,
                source_post=source_post,
            )
        )

        source_focus = self.skill._extract_source_focus(self.skill._normalize_source_post(source_post))
        self.assertNotIn("ai", source_focus["priority_cues"])

    def test_source_repair_allows_full_priority_match_with_translated_secondary_cues(self):
        source_post = {
            "title": "COINBASE CEO 在 FOX 直播称所有 G20 国家将很快建立战略比特币储备 🚀 看涨",
            "body": "COINBASE CEO SAID LIVE ON FOX THAT ALL G20 NATIONS WILL ESTABLISH A STRATEGIC BITCOIN RESERVE SOON 🚀 BULLISH",
        }
        source_focus = self.skill._extract_source_focus(self.skill._normalize_source_post(source_post))
        script_units = [
            {
                "id": "script_001",
                "role": "hook",
                "text": "Coinbase CEO 表示，所有 G20 国家很快会建立战略比特币储备，这对比特币是明显看涨信号。",
            }
        ]

        coverage = self.skill._script_source_coverage(script_units, source_focus)

        self.assertEqual(coverage["priority_coverage_ratio"], 1.0)
        self.assertFalse(self.skill._needs_source_repair(source_focus, coverage))

    def test_source_repair_accepts_chinese_script_covering_translated_source_facts(self):
        source_post = {
            "title": "🚨白宫拒绝回应内幕交易指控，BBC 揭露特朗普宣布前市场异常飙升，涉及伊朗战争",
            "body": (
                "🚨白宫拒绝回应内幕交易指控，BBC 揭露特朗普宣布前市场异常飙升，涉及伊朗战争\n"
                "🚨 White House refuses to address insider trading allegations after BBC uncovers "
                "market spikes before Trump's announcements, including Iran war."
            ),
        }
        source_focus = self.skill._extract_source_focus(self.skill._normalize_source_post(source_post))
        script_units = [
            {
                "id": "script_001",
                "role": "hook",
                "text": "白宫拒绝回应内幕交易指控。BBC 揭露特朗普宣布前市场异常飙升，涉及伊朗战争等地缘消息。",
            },
            {
                "id": "script_002",
                "role": "explain",
                "text": "这不是单纯盘面波动，而是公告前市场异动与未公开信息之间的疑问。",
            },
        ]

        coverage = self.skill._script_source_coverage(script_units, source_focus)

        self.assertGreaterEqual(coverage.get("fact_coverage_ratio", 0), 0.60)
        self.assertFalse(self.skill._needs_source_repair(source_focus, coverage))

    def test_combined_rewrite_accepts_llm_output_without_local_guardrail_rejection(self):
        source_post = {
            "title": "COINBASE CEO 在 FOX 直播称所有 G20 国家将很快建立战略比特币储备 🚀 看涨",
            "body": "COINBASE CEO SAID LIVE ON FOX THAT ALL G20 NATIONS WILL ESTABLISH A STRATEGIC BITCOIN RESERVE SOON 🚀 BULLISH",
        }
        source_post_info = self.skill._normalize_source_post(source_post)
        source_focus = self.skill._extract_source_focus(source_post_info)
        outline_items = [
            {
                "id": "segment_1",
                "text": "Brian Armstrong appears next to a Bitcoin chart on Fox Business.",
            }
        ]
        response_payload = {
            "script_units": [
                {
                    "unit_id": 1,
                    "role": "hook",
                    "text": "你能想象吗？单笔资金高达一百亿美元，直接砸向了人工智能赛道",
                    "content_intent": {},
                    "evidence": {},
                },
                {
                    "unit_id": 2,
                    "role": "explain",
                    "text": "这家科技巨头没选软件，反而把筹码全押在了硬件基建上，动作相当坚决",
                    "content_intent": {},
                    "evidence": {},
                },
            ]
        }

        class FakeResponse:
            text = __import__("json").dumps(response_payload, ensure_ascii=False)

        with patch("pipeline.skills.script_rewriter_skill.generate_content", return_value=FakeResponse()):
            result = self.skill._run_combined(
                client=object(),
                model="test-model",
                provider="test",
                source_post_info=source_post_info,
                source_focus=source_focus,
                outline_items=outline_items,
                audio_snippets=[],
                segment_items=[],
                route={},
                outline={},
                context_blob=self.skill._build_context_blob(source_post_info, outline_items, [], []),
            )

        self.assertIsNotNone(result)
        script_units = result.output.get("script_units") or []
        self.assertEqual(len(script_units), 2)
        self.assertIn("人工智能赛道", script_units[0]["text"])
        self.assertLess(result.meta["source_coverage"]["coverage_ratio"], 0.40)
        self.assertIn("硬件基建", result.meta["out_of_scope_terms"])


if __name__ == "__main__":
    unittest.main()
