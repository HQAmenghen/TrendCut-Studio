# Fix TTS Narration For Law Bill Identifiers

## Goal
Prevent avatar voiceover TTS from reading law bill identifiers such as `HR 3000,633` as large numeric values like three million.

## Scope
- Add TTS-specific narration normalization for bill/code-like identifiers.
- Use the normalized speech text for QwenTTS synthesis and cache signatures.
- Preserve existing workflow/display narration behavior where possible.
- Add focused Jest regression coverage.

## Validation
- Run focused materialDriven avatar workflow/generation tests.
