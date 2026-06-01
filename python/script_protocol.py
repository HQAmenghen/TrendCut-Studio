import json
import os
import traceback


PROTOCOL_PREFIX = "__CODEX_PYTHON__"
PROTOCOL_VERSION = "jsonl-v1"


def protocol_enabled() -> bool:
    return os.getenv("CODEX_PYTHON_PROTOCOL") == PROTOCOL_VERSION


def validate_protocol_payload(payload: dict) -> None:
    if not isinstance(payload, dict):
        raise ValueError("protocol payload must be a dict")
    event_type = str(payload.get("type") or "").strip()
    if event_type not in {"stage", "result", "error"}:
        raise ValueError("protocol payload type must be stage, result, or error")
    if event_type == "stage":
        if not str(payload.get("stage") or "").strip():
            raise ValueError("stage event requires stage")
        if not isinstance(payload.get("message"), str):
            raise ValueError("stage event requires string message")
    elif event_type == "result":
        if not isinstance(payload.get("message"), str):
            raise ValueError("result event requires string message")
    elif event_type == "error":
        for field in ("code", "message", "stage", "details", "hint"):
            if not isinstance(payload.get(field), str):
                raise ValueError(f"error event requires string {field}")
        if not payload["code"].strip() or not payload["message"].strip() or not payload["stage"].strip():
            raise ValueError("error event requires non-empty code, message, and stage")


def emit_protocol(payload: dict) -> None:
    if not protocol_enabled():
        return
    validate_protocol_payload(payload)
    print(f"{PROTOCOL_PREFIX}{json.dumps(payload, ensure_ascii=False)}", flush=True)


def emit_stage(stage: str, message: str = "", **extra) -> None:
    emit_protocol({
        "type": "stage",
        "stage": str(stage or "").strip(),
        "message": str(message or "").strip(),
        **extra,
    })


def emit_result(message: str = "", **extra) -> None:
    emit_protocol({
        "type": "result",
        "message": str(message or "").strip(),
        **extra,
    })


def emit_error(code: str, message: str, stage: str = "python", details: str = "", hint: str = "") -> None:
    emit_protocol({
        "type": "error",
        "code": str(code or "PYTHON_SCRIPT_FAILED").strip(),
        "message": str(message or "Python script failed").strip(),
        "stage": str(stage or "python").strip(),
        "details": str(details or "").strip(),
        "hint": str(hint or "").strip(),
    })


def run_guarded(main_fn, *, error_code: str, error_message: str, error_stage: str, hint: str = "") -> int:
    try:
        result = main_fn()
        if isinstance(result, int):
            return result
        return 0
    except Exception as exc:
        emit_error(
            getattr(exc, "code", error_code),
            getattr(exc, "message", error_message),
            stage=getattr(exc, "stage", error_stage),
            details=getattr(exc, "details", str(exc)),
            hint=getattr(exc, "hint", hint),
        )
        traceback.print_exc()
        return 1
