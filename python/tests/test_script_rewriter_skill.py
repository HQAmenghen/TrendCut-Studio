import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
for candidate in (PROJECT_ROOT, PYTHON_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from pipeline.skills.partition_prompt_profile import format_partition_addendum, resolve_partition_prompt_profile  # noqa: E402
from pipeline.skills.fresh_context import build_fresh_context, is_time_sensitive_source  # noqa: E402
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

    def test_normalized_source_post_strips_monitor_account_but_keeps_content_people(self):
        source_post = self.skill._normalize_source_post({
            "body": "@BMNRBullz - 🚨 COULD TOM LEE BE RIGHT ABOUT A 15-20% SUMMER DRAWDOWN?",
            "author": "BMNRBullz",
            "postUrl": "https://x.com/BMNRBullz/status/2056061081995378881",
        })
        prompt_payload = self.skill._source_post_for_prompt(source_post)

        self.assertNotIn("BMNRBullz", prompt_payload["body"])
        self.assertNotIn("author", prompt_payload)
        self.assertIn("TOM LEE", prompt_payload["body"])
        self.assertIn("BMNRBullz", source_post["forbidden_source_account_terms"])

    def test_source_post_strips_bare_handle_attribution_prefixes(self):
        documenting = self.skill._normalize_source_post({
            "body": "DocumentingBTC今天直播提到比特币可能继续走强。",
            "author": "DocumentingBTC",
        })
        vivek = self.skill._normalize_source_post({
            "body": "Vivek4real 分享了一段 Jack Dorsey 的采访。",
            "author": "Vivek4real",
        })

        self.assertNotIn("DocumentingBTC", documenting["body"])
        self.assertIn("比特币", documenting["body"])
        self.assertNotIn("Vivek4real", vivek["body"])
        self.assertIn("Jack Dorsey", vivek["body"])

    def test_source_account_mentions_rejected_without_rejecting_video_person(self):
        source_post_info = self.skill._normalize_source_post({
            "body": "@BMNRBullz - Tom Lee warns about a 15-20% summer drawdown.",
            "author": "BMNRBullz",
        })
        source_focus = self.skill._extract_source_focus(source_post_info)
        bad_units = [
            {"text": "BMNRBullz账号分享Tom Lee最新判断，夏季可能回调15-20%。"}
        ]
        good_units = [
            {"text": "Tom Lee最新判断是，夏季可能先回调15-20%，之后再迎来更大的反弹。"}
        ]

        self.assertEqual(self.skill._find_source_account_mentions(bad_units, source_focus), ["BMNRBullz"])
        self.assertEqual(self.skill._find_source_account_mentions(good_units, source_focus), [])

    def test_source_account_detection_does_not_reject_real_spaced_person_name(self):
        source_post_info = self.skill._normalize_source_post({
            "body": "@elonmusk - Elon Musk discusses xAI and Tesla.",
            "author": "elonmusk",
        })
        source_focus = self.skill._extract_source_focus(source_post_info)
        units = [
            {"text": "Elon Musk 这次谈到 xAI 和 Tesla 的协同，重点放在产品节奏上。"}
        ]

        self.assertEqual(self.skill._find_source_account_mentions(units, source_focus), [])

    def test_parenthetical_english_gloss_is_removed_from_voiceover_text(self):
        cleaned = self.skill._sanitize_unit_text(
            "他称这是我们人生中最大的反弹（THE BIGGEST RALLY OF OUR LIFETIME）前的痛苦。"
        )

        self.assertNotIn("（THE BIGGEST RALLY OF OUR LIFETIME）", cleaned)
        self.assertEqual(cleaned, "他称这是我们人生中最大的反弹前的痛苦")

    def test_repair_prompt_includes_source_account_and_parenthetical_constraints(self):
        prompt = self.skill._build_repair_prompt(
            base_prompt="base",
            source_focus={"has_source_anchor": True, "numeric_cues": []},
            coverage={"missing_cues": []},
            current_units=[{"text": "BMNRBullz账号分享Tom Lee观点（THE BIGGEST RALLY）。"}],
            source_account_mentions=["BMNRBullz"],
            parenthetical_glosses=["（THE BIGGEST RALLY）"],
        )

        self.assertIn("监控来源账号", prompt)
        self.assertIn("BMNRBullz", prompt)
        self.assertIn("括号英文注释", prompt)
        self.assertIn("THE BIGGEST RALLY", prompt)

    def test_time_sensitive_trump_bitcoin_source_requires_fresh_context(self):
        source_post = {
            "title": "特朗普总统：比特币减轻了美元的压力",
            "body": "President Trump: Bitcoin takes a lot of pressure off the dollar.",
        }

        self.assertTrue(is_time_sensitive_source(source_post))

        with patch.dict("os.environ", {"XAI_API_KEY": ""}, clear=False):
            context = build_fresh_context(
                source_post,
                now=datetime(2026, 5, 28, tzinfo=timezone(timedelta(hours=8))),
            )

        self.assertTrue(context["required"])
        self.assertEqual(context["status"], "skipped_missing_key")
        self.assertEqual(context["current_year"], 2026)
        self.assertIn("2025年开年", "".join(context["stale_phrases_to_avoid"]))

    def test_freshness_instruction_forbids_stale_year_when_search_unavailable(self):
        prompt = self.skill._build_freshness_instruction({
            "required": True,
            "status": "skipped_missing_key",
            "current_date": "2026-05-28",
            "current_year": 2026,
            "query": "特朗普 比特币 美元压力",
            "stale_phrases_to_avoid": ["不要把当前事件写成2025年开年"],
            "error": "Missing XAI_API_KEY",
        })

        self.assertIn("2026-05-28", prompt)
        self.assertIn("不得凭模型记忆补旧年份", prompt)
        self.assertIn("2025年开年", prompt)

    def test_combined_rewrite_rejects_if_repair_keeps_source_account_or_parenthetical(self):
        source_post = {
            "body": "@BMNRBullz - Tom Lee warns about a 15-20% summer drawdown.",
            "author": "BMNRBullz",
        }
        source_post_info = self.skill._normalize_source_post(source_post)
        source_focus = self.skill._extract_source_focus(source_post_info)
        invalid_payload = {
            "script_units": [
                {
                    "unit_id": 1,
                    "role": "hook",
                    "text": "BMNRBullz账号分享Tom Lee判断：夏季可能回调15-20%（SUMMER DRAWDOWN）。",
                    "content_intent": {},
                    "evidence": {},
                },
                {
                    "unit_id": 2,
                    "role": "explain",
                    "text": "他认为短期压力之后还要看更大反弹。",
                    "content_intent": {},
                    "evidence": {},
                },
            ]
        }

        class FakeResponse:
            text = __import__("json").dumps(invalid_payload, ensure_ascii=False)

        with patch("pipeline.skills.script_rewriter_skill.generate_content", return_value=FakeResponse()):
            result = self.skill._run_combined(
                client=object(),
                model="test-model",
                provider="test",
                source_post_info=source_post_info,
                source_focus=source_focus,
                outline_items=[],
                audio_snippets=[],
                segment_items=[],
                route={},
                outline={},
                context_blob=self.skill._build_context_blob(source_post_info, [], [], []),
            )

        self.assertIsNone(result)

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

    def test_time_sensitive_source_triggers_freshness_search(self):
        source_post_info = self.skill._normalize_source_post({
            "title": "特朗普总统：比特币减轻了美元的压力，比我们投资的任何东西都重要得多。",
            "body": "President Trump: Bitcoin takes a lot of pressure off the dollar.",
        })

        self.assertTrue(self.skill._needs_freshness_search(source_post_info))

    def test_freshness_instruction_warns_against_stale_year_when_search_fails(self):
        prompt = self.skill._build_freshness_instruction({
            "enabled": True,
            "current_date": "2026-05-28",
            "searched": False,
            "query": "特朗普 比特币 美元 压力",
            "error": "Missing XAI_API_KEY",
        })

        self.assertIn("2026-05-28", prompt)
        self.assertIn("不得凭模型记忆补旧年份", prompt)
        self.assertIn("改用“近期”“这次表态”", prompt)

    def test_run_passes_freshness_context_into_combined_prompt_and_meta(self):
        source_post = {
            "title": "特朗普总统：比特币减轻了美元的压力，比我们投资的任何东西都重要得多。",
            "body": "President Trump: Bitcoin takes a lot of pressure off the dollar.",
        }
        response_payload = {
            "script_units": [
                {
                    "unit_id": 1,
                    "role": "hook",
                    "text": "特朗普这次把比特币和美元压力放在同一句话里，信号确实不轻。",
                    "content_intent": {},
                    "evidence": {},
                },
                {
                    "unit_id": 2,
                    "role": "explain",
                    "text": "但这类表态要放回当前政策和市场语境里看，不能直接当成投资信号。",
                    "content_intent": {},
                    "evidence": {},
                },
                {
                    "unit_id": 3,
                    "role": "ending",
                    "text": "真正要观察的，是美国政界对数字资产的态度，会不会继续改变监管预期。",
                    "content_intent": {},
                    "evidence": {},
                },
            ]
        }

        class FakeResponse:
            text = __import__("json").dumps(response_payload, ensure_ascii=False)

        captured_prompts = []

        def fake_generate_content(_client, **kwargs):
            captured_prompts.append(kwargs["contents"])
            return FakeResponse()

        with patch.object(self.skill, "_fetch_freshness_context", return_value={
            "enabled": True,
            "current_date": "2026-05-28",
            "searched": True,
            "query": "特朗普 比特币 美元 压力",
            "verified_facts": ["2026-05-28 context verified"],
            "stale_or_unsafe_claims": ["不要写2025年开年"],
            "date_guidance": "这次表态按2026年当前语境处理。",
            "source_notes": ["x_search"],
        }), \
             patch("pipeline.skills.script_rewriter_skill.create_llm_client", return_value=object()), \
             patch("pipeline.skills.script_rewriter_skill.generate_content", side_effect=fake_generate_content):
            result = self.skill.run({"source_post": source_post})

        self.assertEqual(result.meta["status"], "ready")
        self.assertIn("2026-05-28", captured_prompts[0])
        self.assertIn("不要写2025年开年", captured_prompts[0])
        self.assertTrue(result.meta["freshness_context"]["live_search_performed"])


if __name__ == "__main__":
    unittest.main()
