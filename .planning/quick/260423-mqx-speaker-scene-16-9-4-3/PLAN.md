# 4:3 Master Canvas Plan

Goal: Remove the recently added vertical `speaker_scene` smart-crop handoff so finished renders are never reframed at the standalone vertical stage, then switch the main smart-composer master canvas from `16:9` to `4:3`.

Architecture: Delete the standalone `--plan` handoff and the unused vertical framing parser/filter support in `make_vertical_video.py`. Update the smart composer canvas resolver to inscribe a `4:3` landscape canvas so both avatar and material clips normalize against the same `4:3` master before final vertical packaging.

Tech Stack: Python 3, Node.js, unittest, Jest, ESLint.

## Tasks

1. Update tests to lock the new behavior: no standalone `--plan` handoff and `4:3` smart-composer canvas sizing.
2. Remove the vertical `speaker_scene` smart-crop chain from standalone render and `make_vertical_video.py`.
3. Change smart composer landscape canvas normalization from `16:9` to `4:3`.
4. Run focused Python, Jest, and ESLint verification.
