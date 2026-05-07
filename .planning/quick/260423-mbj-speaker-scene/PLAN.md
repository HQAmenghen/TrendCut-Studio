# Speaker Scene Framing Plan

Goal: Let standalone vertical composition consume `speaker_scene.json` framing hints so horizontal footage recenters the subject within the crop window instead of always using a fixed center crop.

Architecture: Keep the existing standalone render flow and fix the broken handoff points. Extend `make_vertical_video.py` to accept `speaker_scene.json`'s `timeline` payload as a valid framing plan, and update the standalone server handler to pass `speaker_scene.json` to the renderer whenever the file exists in the runtime job directory.

Tech Stack: Python 3, Express/Node.js, unittest, Jest.

## Tasks

1. Add a Python regression test proving `load_vertical_plan()` accepts `speaker_scene.json` timeline data.
2. Add a Jest regression test proving standalone render passes `--plan` to `make_vertical_video.py` when ASR produces `speaker_scene.json`.
3. Implement the minimal production changes in `make_vertical_video.py` and `server/services/vertical/standalone.js`.
4. Run focused Python and Jest verification for the framing handoff.
