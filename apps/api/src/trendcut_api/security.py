from fastapi import Header, HTTPException

from .settings import get_settings

INTERNAL_TOKEN_HEADER = 'x-trendcut-internal-token'


def require_internal_token(x_trendcut_internal_token: str | None = Header(default=None)) -> None:
    expected = get_settings().internal_api_token
    if not expected:
        raise HTTPException(status_code=503, detail='Internal API token is not configured')
    if x_trendcut_internal_token != expected:
        raise HTTPException(status_code=403, detail='Internal API token required')
