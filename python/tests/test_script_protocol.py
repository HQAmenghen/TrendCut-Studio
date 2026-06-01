import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


PYTHON_ROOT = Path(__file__).resolve().parents[1]
python_root_str = str(PYTHON_ROOT)
if python_root_str not in sys.path:
    sys.path.insert(0, python_root_str)

import script_protocol


class ScriptProtocolTest(unittest.TestCase):
    def test_protocol_enabled_requires_current_version(self):
        with patch.dict(os.environ, {"CODEX_PYTHON_PROTOCOL": script_protocol.PROTOCOL_VERSION}):
            self.assertTrue(script_protocol.protocol_enabled())

        with patch.dict(os.environ, {"CODEX_PYTHON_PROTOCOL": "legacy"}, clear=False):
            self.assertFalse(script_protocol.protocol_enabled())

    def test_validate_protocol_payload_accepts_valid_events(self):
        script_protocol.validate_protocol_payload({
            "type": "stage",
            "stage": "subtitle_reference_authority",
            "message": "working",
        })
        script_protocol.validate_protocol_payload({
            "type": "result",
            "message": "done",
        })
        script_protocol.validate_protocol_payload({
            "type": "error",
            "code": "REFERENCE_AUTHORITY_ALIGNMENT_FAILED",
            "message": "failed",
            "stage": "subtitle_reference_authority",
            "details": "",
            "hint": "",
        })

    def test_validate_protocol_payload_rejects_malformed_events(self):
        with self.assertRaises(ValueError):
            script_protocol.validate_protocol_payload({
                "type": "stage",
                "message": "missing stage",
            })

        with self.assertRaises(ValueError):
            script_protocol.validate_protocol_payload({
                "type": "error",
                "code": "BAD",
                "message": "failed",
                "stage": "subtitle_reference_authority",
                "details": "",
            })


if __name__ == "__main__":
    unittest.main()
