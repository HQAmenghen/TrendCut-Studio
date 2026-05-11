import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
PIPELINE_ROOT = PYTHON_ROOT / "pipeline"
for candidate in (PROJECT_ROOT, PYTHON_ROOT, PIPELINE_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from pipeline.subtitle_terms import (  # noqa: E402
    extract_preserve_terms,
    has_traditional_chinese,
    mask_preserved_terms,
    repair_reference_subtitle_text,
    restore_preserved_terms,
    to_simplified_chinese,
)


class SubtitleTermsTest(unittest.TestCase):
    def test_converts_common_traditional_subtitle_text_to_simplified(self):
        text = "比特幣2032年將突破100萬美元，他把當下階段定義為信息套利，多數人還在門外。"

        simplified = to_simplified_chinese(text)

        self.assertEqual(
            simplified,
            "比特币2032年将突破100万美元，他把当下阶段定义为信息套利，多数人还在门外。",
        )
        self.assertTrue(has_traditional_chinese(text))
        self.assertFalse(has_traditional_chinese(simplified))

    def test_converts_finance_policy_terms_to_simplified(self):
        text = "Clarity Act 將釐清代幣屬性，通過後吸引更多機構資金湧入。"

        self.assertEqual(
            to_simplified_chinese(text),
            "Clarity Act 将厘清代币属性，通过后吸引更多机构资金涌入。",
        )

    def test_extracts_mixed_case_terms_numbers_and_tickers(self):
        text = "OpenAI 和 ChatGPT 在 20.5 美元价位讨论 Kalshi 与 BTC。"

        terms = extract_preserve_terms(text)

        self.assertIn("OpenAI", terms)
        self.assertIn("ChatGPT", terms)
        self.assertIn("20.5", terms)
        self.assertIn("Kalshi", terms)
        self.assertIn("BTC", terms)

    def test_extracts_latin_terms_touching_cjk_text(self):
        text = "但Phong Le在采访里说，Tom Lee称美股触及新高。"

        terms = extract_preserve_terms(text)

        self.assertIn("Phong Le", terms)
        self.assertIn("Tom Lee", terms)

    def test_mask_and_restore_round_trip_preserves_original_terms(self):
        text = "OpenAI 和 ChatGPT 在 20.5 美元价位讨论 Kalshi 与 BTC。"

        masked, placeholders = mask_preserved_terms(text)
        restored = restore_preserved_terms(masked, placeholders)

        self.assertNotEqual(masked, text)
        self.assertIn("[[TERM_", masked)
        self.assertEqual(restored, text)

    def test_does_not_preserve_joined_english_sentence_as_term(self):
        text = "Whensomebodyisusingtheinternet，是互联网在犯罪还是人在犯罪？"

        terms = extract_preserve_terms(text)
        masked, placeholders = mask_preserved_terms(text)

        self.assertNotIn("Whensomebodyisusingtheinternet", terms)
        self.assertEqual(placeholders, {})
        self.assertEqual(masked, text)

    def test_does_not_preserve_mixed_case_joined_english_sentence_prefix(self):
        text = "AndsoIthinkthat'sthewaytothinkaboutit."

        terms = extract_preserve_terms(text)
        masked, placeholders = mask_preserved_terms(text)

        self.assertNotIn("AndsoIthinkthat", terms)
        self.assertEqual(placeholders, {})
        self.assertEqual(masked, text)

    def test_repairs_partial_person_name_from_reference_text(self):
        text = "但Phong在采访里说，Phong说卖股权不如卖比特币划算。"
        reference_text = "但Phong Le在采访里说得很直接。Phong Le说，卖股权付股息不如卖比特币划算。"

        repaired = repair_reference_subtitle_text(text, reference_text)

        self.assertEqual(
            repaired,
            "但Phong Le在采访里说，Phong Le说卖股权不如卖比特币划算。",
        )

    def test_repairs_meigu_only_in_stock_market_contexts(self):
        text = "每股首次触及7400点，每股市场涨幅扩大。"

        repaired = repair_reference_subtitle_text(text, "")

        self.assertEqual(repaired, "美股首次触及7400点，美股市场涨幅扩大。")

    def test_preserves_valid_per_share_contexts(self):
        text = "只要卖比特币能让每股价值更优，每股收益也会改善。"

        repaired = repair_reference_subtitle_text(text, "")

        self.assertEqual(repaired, text)

    def test_repairs_truncated_numeric_amount_from_reference_text(self):
        text = "一只股票从3美元跌到0.42美元，"
        reference_text = "一只股票从333美元跌到0.42美元，"

        repaired = repair_reference_subtitle_text(text, reference_text)

        self.assertEqual(repaired, "一只股票从333美元跌到0.42美元，")

    def test_appends_missing_numeric_target_when_subtitle_is_reference_prefix(self):
        text = "昨晚放出惊人预测：比特币将达到"
        reference_text = "亿万富翁Tim Draper昨晚放出惊人预测：比特币将达到1000万美元，"

        repaired = repair_reference_subtitle_text(text, reference_text)

        self.assertEqual(repaired, "昨晚放出惊人预测：比特币将达到1000万美元，")

    def test_repairs_missing_numeric_target_inside_reference_clause(self):
        text = "所以，加密世界，"
        reference_text = "所以，2026年的加密世界，一句玩笑比十份研报还具传播力。"

        repaired = repair_reference_subtitle_text(text, reference_text)

        self.assertEqual(repaired, "所以，2026年的加密世界，")

    def test_repairs_missing_numeric_amount_inside_reference_clause(self):
        text = "这家公司营收突破，市场情绪升温。"
        reference_text = "这家公司营收突破1200万美元，市场情绪升温。"

        repaired = repair_reference_subtitle_text(text, reference_text)

        self.assertEqual(repaired, "这家公司营收突破1200万美元，市场情绪升温。")


if __name__ == "__main__":
    unittest.main()
