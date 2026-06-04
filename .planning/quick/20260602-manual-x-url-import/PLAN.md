# Manual X URL Import

Add a manual import path that accepts an X post URL, resolves the tweet text and video material into the same item shape used by the xAI leaderboard, then lets operators send it into the existing material-driven workflow.

Scope:
- Add a backend xAI endpoint for importing one X post URL.
- Add Python single-post import mode that reuses existing enrichment/video variant helpers.
- Add frontend source intake controls and state for URL import.
- Verify with focused tests/lint where practical.
