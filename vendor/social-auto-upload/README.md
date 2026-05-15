# social-auto-upload vendor subset

This directory contains a source subset from
https://github.com/dreammis/social-auto-upload.

It is vendored for this project only, so the publish center can reuse the
maintained Douyin and Xiaohongshu uploader logic without depending on a second
checkout outside the app directory.

Included:
- Douyin uploader source
- Xiaohongshu uploader source
- shared uploader base class
- shared browser utilities, including `utils/stealth.min.js`

Excluded:
- upstream virtual environments and package metadata
- cookies and browser login state
- logs and databases
- demo media and generated assets
- unrelated platform uploaders

Runtime state is stored under this project's
`data/social-auto-upload-runtime/` directory.
