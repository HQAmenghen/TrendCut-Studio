from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from trendcut_api.database import get_session
from trendcut_api.llm_service import generate_ai
from trendcut_api.prompt_registry import load_prompt_registry

router = APIRouter(prefix='/ai', tags=['ai'])


class AiGenerateRequest(BaseModel):
    capability: str = Field(min_length=1)
    input: dict[str, Any] = Field(default_factory=dict)
    task_id: str | None = None
    preferred_models: list[str] | None = None


@router.get('/prompts')
def list_prompts():
    return load_prompt_registry()


@router.post('/generate')
async def generate(payload: AiGenerateRequest, session: Session = Depends(get_session)):
    try:
        return await generate_ai(
            session=session,
            capability=payload.capability,
            payload=payload.input,
            task_id=payload.task_id,
            preferred_models=payload.preferred_models
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
