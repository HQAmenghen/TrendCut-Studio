# Vendored social-auto-upload

Source: https://github.com/dreammis/social-auto-upload

Imported revision: `34a3b3b47e5d2d3fa7f96ac180c7d9a351421f30`

This project vendors the uploader source needed by the local publish center for
Douyin and Xiaohongshu. Runtime state is intentionally not stored here.

Tracked here:
- shared uploader code
- Douyin uploader
- Xiaohongshu uploader
- shared browser utilities
- local README for this vendored subset

Not tracked here:
- `.venv`
- cookies and browser storage state
- logs
- databases
- sample media
- generated assets
- upstream package metadata for the full multi-platform project

Runtime cookies and logs are written under the host project's
`data/social-auto-upload-runtime/` directory.
