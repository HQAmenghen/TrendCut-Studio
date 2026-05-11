Debug session continued and the root cause is identified: adjacent subtitle rows could keep overlapping suffix/prefix text after LLM/reference alignment, and the previous cleanup only handled a narrow duplicate case.

The fix is in [run_asr.py](C:/Users/PC/Desktop/comfy_panel_demo/python/pipeline/run_asr.py:1651): it now trims generic adjacent duplicate prefixes for Chinese-visible text and analogous English word overlaps. Regression tests were added at [test_run_asr_filetrans.py](C:/Users/PC/Desktop/comfy_panel_demo/python/tests/test_run_asr_filetrans.py:754).

Self-verification from the debug manager passed:

```powershell
python -m unittest python.tests.test_run_asr_filetrans python.tests.test_subtitle_terms python.tests.test_make_vertical_video
```

I changed the debug session state back to `awaiting_human_verify` in [.planning/debug/standalone-uyun7z37m-subs.md](C:/Users/PC/Desktop/comfy_panel_demo/.planning/debug/standalone-uyun7z37m-subs.md:2), because the workflow should only mark it resolved after you confirm the real standalone output no longer repeats adjacent subtitle text.