from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    api_env: str = 'local'
    database_url: str = 'postgresql+psycopg://trendcut:trendcut@127.0.0.1:5432/trendcut'
    redis_url: str = 'redis://127.0.0.1:6379/0'
    litellm_base_url: str | None = None
    litellm_api_key: str | None = None
    llm_model_order: str = 'qwen-plus,deepseek-chat,gemini-2.5-flash,local-template-v1'
    internal_api_token: str = 'dev-internal-token'


@lru_cache
def get_settings() -> Settings:
    return Settings()
