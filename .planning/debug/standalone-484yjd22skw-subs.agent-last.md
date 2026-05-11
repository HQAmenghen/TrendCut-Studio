## DEBUG COMPLETE

root_cause: ASR/reference alignment let protected terms like `Consensus` be translated in `zh`, and duplicate-prefix cleanup missed the `Consensus 2026大会` + `大会上` boundary case.

what_changed: Added reference-aware `Consensus` restoration in `python/pipeline/subtitle_terms.py`, tightened duplicate-prefix cleanup in `python/pipeline/run_asr.py`, updated ASR/subtitle regression tests, and marked `.planning/debug/standalone-484yjd22skw-subs.md` resolved with evidence and verification.

verification: Passed `python -m unittest python.tests.test_subtitle_terms`, `python -m unittest python.tests.test_run_asr_filetrans`, and `npm test -- --runInBand server/services/vertical/__tests__/standaloneTaskImport.test.js server/services/vertical/__tests__/taskImport.test.js`.